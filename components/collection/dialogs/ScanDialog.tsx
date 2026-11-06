import { getTranslations } from "../../../lib/server/preferences.ts";

export default async function ScanDialog() {
  const t = await getTranslations();
  return (
    <dialog id={"scanDialog"} aria-labelledby={"scanTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"scanTitle"}>{t("Scan a book")}</h2>
          <p>{t("Include the barcode and any printed ISBN above it.")}</p>
        </div>
        <button
          id={"closeScan"}
          className={"close"}
          aria-label={t("Close scanner")}
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
            {t("Take photo")}
            <input
              id={"barcodePhoto"}
              type={"file"}
              accept={"image/*"}
              capture={"environment"}
              aria-label={t("Take a barcode photo")}
            />
          </label>
          <label className={"btn file"}>
            {t("Choose photo")}
            <input
              id={"chooseBarcodePhoto"}
              type={"file"}
              accept={"image/*"}
              aria-label={t("Choose a barcode photo")}
            />
          </label>
          <button id={"startCamera"} className={"btn"} type={"button"}>
            {t("Live camera")}
          </button>
          <button id={"stopCamera"} className={"btn"} type={"button"} hidden>
            {t("Stop camera")}
          </button>
        </div>
        <p id={"scanMessage"} className={"scanner-note"} role={"status"}>
          {t(
            "Take or choose a photo, or use the live camera. Photos stay on your device.",
          )}
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
