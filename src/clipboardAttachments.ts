type ClipboardFileSource = Pick<DataTransfer, "files" | "items">;

export function clipboardAttachmentFiles(source: ClipboardFileSource): File[] {
  const directFiles = Array.from(source.files ?? []);

  if (directFiles.length > 0) {
    return directFiles;
  }

  return Array.from(source.items ?? []).flatMap((item) => {
    if (item.kind !== "file") {
      return [];
    }

    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
