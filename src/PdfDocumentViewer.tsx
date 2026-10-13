import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, Scan } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const minZoom = 0.65;
const maxZoom = 3;

function boundedZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, Math.round(value * 20) / 20));
}

function PdfPage({ document, pageNumber, availableWidth, zoom }: {
  document: PDFDocumentProxy;
  pageNumber: number;
  availableWidth: number;
  zoom: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [aspectRatio, setAspectRatio] = useState(1 / 1.4142);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || nearViewport) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { root: host.closest(".pdf-document-scroll"), rootMargin: "120% 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport) return;
    let cancelled = false;
    void document.getPage(pageNumber).then((loadedPage) => {
      if (cancelled) return;
      const viewport = loadedPage.getViewport({ scale: 1 });
      setAspectRatio(viewport.width / viewport.height);
      setPage(loadedPage);
    });
    return () => { cancelled = true; };
  }, [document, nearViewport, pageNumber]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas || availableWidth <= 0) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = (availableWidth / baseViewport.width) * zoom;
    const cssViewport = page.getViewport({ scale: cssScale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const renderViewport = page.getViewport({ scale: cssScale * outputScale });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
    canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
    setRendered(false);
    const task = page.render({ canvas, canvasContext: context, viewport: renderViewport });
    void task.promise.then(() => setRendered(true)).catch((error: unknown) => {
      if ((error as { name?: string })?.name !== "RenderingCancelledException") throw error;
    });
    return () => task.cancel();
  }, [availableWidth, page, zoom]);

  const pageWidth = Math.max(1, availableWidth * zoom);
  return (
    <div
      ref={hostRef}
      className={`pdf-document-page${rendered ? " is-rendered" : ""}`}
      data-pdf-page={pageNumber}
      style={{ width: pageWidth, minHeight: pageWidth / aspectRatio }}
      aria-label={`Page ${pageNumber}`}
    >
      {page ? <canvas ref={canvasRef} /> : <Loader2 className="spin pdf-page-loader" size={22} />}
    </div>
  );
}

export function PdfDocumentViewer({ source, label }: { source: string; label: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [availableWidth, setAvailableWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    setDocument(null);
    setError("");
    setPageNumber(1);
    setZoom(1);
    const task = getDocument({ url: source });
    void task.promise.then(setDocument).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not open this PDF");
    });
    return () => { void task.destroy(); };
  }, [source]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const update = () => setAvailableWidth(Math.max(1, Math.min(scroll.clientWidth - 24, 1060)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  const updateCurrentPage = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const center = scroll.getBoundingClientRect().top + scroll.clientHeight * 0.42;
    let closestPage = 1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const page of scroll.querySelectorAll<HTMLElement>("[data-pdf-page]")) {
      const rect = page.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = Number(page.dataset.pdfPage) || 1;
      }
    }
    setPageNumber(closestPage);
  }, []);

  const touchDistance = (touches: React.TouchList) => {
    const first = touches.item(0);
    const second = touches.item(1);
    return first && second ? Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY) : 0;
  };

  return (
    <div
      ref={scrollRef}
      className="pdf-document-scroll"
      onScroll={updateCurrentPage}
      onTouchStart={(event) => {
        if (event.touches.length === 2) pinchRef.current = { distance: touchDistance(event.touches), zoom };
      }}
      onTouchMove={(event) => {
        if (event.touches.length !== 2 || !pinchRef.current?.distance) return;
        event.preventDefault();
        setZoom(boundedZoom(pinchRef.current.zoom * touchDistance(event.touches) / pinchRef.current.distance));
      }}
      onTouchEnd={() => { pinchRef.current = null; }}
      aria-label={`${label} PDF document`}
    >
      {document ? (
        <>
          <div className="pdf-page-counter" aria-live="polite">{pageNumber} of {document.numPages}</div>
          <div className="pdf-document-pages">
            {Array.from({ length: document.numPages }, (_, index) => (
              <PdfPage key={index + 1} document={document} pageNumber={index + 1} availableWidth={availableWidth} zoom={zoom} />
            ))}
          </div>
          <div className="pdf-zoom-controls" aria-label="PDF zoom controls">
            <button type="button" onClick={() => setZoom((value) => boundedZoom(value - 0.2))} disabled={zoom <= minZoom} aria-label="Zoom out"><Minus size={18} /></button>
            <button type="button" onClick={() => setZoom(1)} aria-label="Fit pages to width"><Scan size={17} /><span>{Math.round(zoom * 100)}%</span></button>
            <button type="button" onClick={() => setZoom((value) => boundedZoom(value + 0.2))} disabled={zoom >= maxZoom} aria-label="Zoom in"><Plus size={18} /></button>
          </div>
        </>
      ) : error ? (
        <div className="pdf-document-state is-error">{error}</div>
      ) : (
        <div className="pdf-document-state"><Loader2 className="spin" size={24} /><span>Opening PDF</span></div>
      )}
    </div>
  );
}
