# Control pad physical orientation

This is the authoritative orientation for `SIDE-KEYBOARD` serial `267E01678182`.

View the pad in its normal operating position shown in the supplied photo: the three knobs are along the top edge and the USB cable enters from the left.

The vendor configurator's 4×4 grid is rotated 90° relative to this physical unit. Two direct hardware observations establish the transform: vendor index `0` is physical bottom-left, while vendor index `12` is physical bottom-right.

| Physical row | Left → right vendor indexes |
| --- | --- |
| Top, nearest knobs | `3`, `7`, `11`, `15` |
| Second | `2`, `6`, `10`, `14` |
| Third | `1`, `5`, `9`, `13` |
| Bottom, nearest lower screws | `0`, `4`, `8`, `12` |

Therefore:

- Physical top-left button is vendor index `3`.
- Physical top-right button is vendor index `15`.
- Physical bottom-left button is vendor index `0`.
- Physical bottom-right button is vendor index `12`.
- Never infer a physical position directly from the configurator's displayed row order for this pad; use the matrix above.

The display-off action belongs to physical top-left/index `3`. The Far view focus toggle belongs to physical top-right/index `15`. Physical bottom-left/index `0` is `[32,1,0,0]` (held Left Ctrl), and physical bottom-right/index `12` is `[32,0,40,0]` (Enter).
