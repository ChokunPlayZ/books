import MergeSeriesDialog from "./dialogs/MergeSeriesDialog";
import { getTranslations } from "../../lib/server/preferences.ts";

export async function SelectionToggle({ grouped }: { grouped: boolean }) {
  const t = await getTranslations();
  return (
    <button
      id="toggleSelection"
      data-grouped={grouped}
      type="button"
      className="text-btn"
      aria-pressed="false"
      title={t("Ctrl/⌘ click to select · Shift click for a range")}
      aria-describedby="selectionHint"
    >
      {t(grouped ? "Select series" : "Select books")}
    </button>
  );
}

export default async function BulkActions({
  removed,
  grouped,
}: {
  removed: boolean;
  grouped: boolean;
}) {
  const t = await getTranslations();
  return (
    <>
      <span id="selectionHint" className="sr-only">
        {t("Ctrl/⌘ click to select · Shift click for a range")}
      </span>
      <div
        id="bulkActions"
        className="bulk-actions"
        role="group"
        aria-label={t("Selected books")}
        hidden
      >
        <div className="bulk-selection-summary">
          <span id="selectionCount" role="status">
            {t("0 books selected")}
          </span>
          <div className="bulk-selection-controls">
            <button id="selectAllBooks" type="button" className="text-btn">
              {t("Select all results")}
            </button>
            <button id="clearSelection" type="button" className="text-btn">
              {t("Clear selection")}
            </button>
          </div>
        </div>
        <div className="bulk-edit-actions">
          {!removed && (
            <div className="bulk-status-actions">
              <label htmlFor="bulkStatus" className="sr-only">
                {t("Reading status for selected books")}
              </label>
              <select id="bulkStatus" defaultValue="Read">
                <option value="Read">{t("Read")}</option>
              </select>
              <button
                id="applyBulkStatus"
                type="button"
                className="btn primary"
              >
                {t("Set status")}
              </button>
            </div>
          )}
          <div className="bulk-organize-actions">
            {grouped && !removed && (
              <button
                id="mergeSeriesButton"
                type="button"
                className="btn"
                disabled
              >
                {t("Merge series")}
              </button>
            )}
            <button
              id="bulkMoveBooks"
              type="button"
              className={"btn" + (removed ? "" : " danger")}
            >
              {t(removed ? "Restore selected" : "Remove selected")}
            </button>
          </div>
        </div>
        <span className="hint selection-hint">
          {t(
            grouped
              ? "Select two or more series to merge · Shift click for a range · Escape to finish"
              : "Click to toggle books · Shift click for a range · Escape to finish",
          )}
        </span>
      </div>
      {grouped && !removed && <MergeSeriesDialog />}
      {!removed && (
        <dialog id="bulkRemoveDialog" aria-labelledby="bulkRemoveTitle">
          <div className="dialog-head">
            <h2 id="bulkRemoveTitle">{t("Remove selected books?")}</h2>
          </div>
          <div className="dialog-body">
            <p id="bulkRemoveSummary" />
            <p className="hint">
              {t("You can restore these books from Recently removed.")}
            </p>
            <div
              id="bulkRemoveError"
              className="form-error"
              role="alert"
              hidden
            />
          </div>
          <div className="dialog-foot">
            <div className="buttons">
              <button id="cancelBulkRemove" type="button" className="btn">
                {t("Keep books")}
              </button>
              <button
                id="confirmBulkRemove"
                type="button"
                className="btn danger"
              >
                {t("Remove books")}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
