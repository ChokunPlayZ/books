export default function ScanDialog() {
  return (
    <dialog id={"scanDialog"} aria-labelledby={"scanTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"scanTitle"}>{"Scan a book"}</h2>
          <p>{"Include the barcode and any printed ISBN above it."}</p>
        </div>
        <button
          id={"closeScan"}
          className={"close"}
          aria-label={"Close scanner"}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <div className={"dialog-body"}>
        <div id={"scannerArea"} className={"scanner-area"}></div>
        <div className={"buttons scan-buttons"}>
          <label className={"btn primary file"}>
            {"Take photo"}
            <input
              id={"barcodePhoto"}
              type={"file"}
              accept={"image/*"}
              capture={"environment"}
              aria-label={"Take a barcode photo"}
            />
          </label>
          <label className={"btn file"}>
            {"Choose photo"}
            <input
              id={"chooseBarcodePhoto"}
              type={"file"}
              accept={"image/*"}
              aria-label={"Choose a barcode photo"}
            />
          </label>
          <button id={"startCamera"} className={"btn"} type={"button"}>
            {"Live camera"}
          </button>
          <button id={"stopCamera"} className={"btn"} type={"button"} hidden>
            {"Stop camera"}
          </button>
        </div>
        <p id={"scanMessage"} className={"scanner-note"} role={"status"}>
          {
            "Take or choose a photo, or use the live camera. Photos stay on your device."
          }
        </p>
        <div
          id={"scanCandidates"}
          className={"buttons scan-buttons"}
          hidden
        ></div>
      </div>
    </dialog>
  );
}
