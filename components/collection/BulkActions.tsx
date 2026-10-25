import MergeSeriesDialog from "./dialogs/MergeSeriesDialog";

export function SelectionToggle({ grouped }: { grouped: boolean }) {
  return (
    <button
      id="toggleSelection"
      type="button"
      className="text-btn"
      aria-pressed="false"
      title="Ctrl/⌘ click to select · Shift click for a range"
      aria-describedby="selectionHint"
    >
      {grouped ? "Select series" : "Select books"}
    </button>
  );
}

export default function BulkActions({
  removed,
  grouped,
}: {
  removed: boolean;
  grouped: boolean;
}) {
  return (
    <>
      <span id="selectionHint" className="sr-only">
        Ctrl/⌘ click to select · Shift click for a range
      </span>
      <div
        id="bulkActions"
        className="bulk-actions"
        role="group"
        aria-label="Selected books"
        hidden
      >
        <span id="selectionCount" role="status">
          0 books selected
        </span>
        <button id="selectAllBooks" type="button" className="text-btn">
          Select all results
        </button>
        <button id="clearSelection" type="button" className="text-btn">
          Clear selection
        </button>
        {grouped && !removed && (
          <button id="mergeSeriesButton" type="button" className="btn" disabled>
            Merge series
          </button>
        )}
        {!removed && (
          <>
            <label htmlFor="bulkStatus" className="sr-only">
              Reading status for selected books
            </label>
            <select id="bulkStatus" defaultValue="Read">
              <option>Read</option>
            </select>
            <button id="applyBulkStatus" type="button" className="btn primary">
              Set status
            </button>
          </>
        )}
        <button
          id="bulkMoveBooks"
          type="button"
          className={"btn" + (removed ? "" : " danger")}
        >
          {removed ? "Restore selected" : "Remove selected"}
        </button>
        <span className="hint selection-hint">
          {grouped
            ? "Select two or more series to merge · Shift click for a range · Escape to finish"
            : "Click to toggle books · Shift click for a range · Escape to finish"}
        </span>
      </div>
      {grouped && !removed && <MergeSeriesDialog />}
      {!removed && (
        <dialog id="bulkRemoveDialog" aria-labelledby="bulkRemoveTitle">
          <div className="dialog-head">
            <h2 id="bulkRemoveTitle">Remove selected books?</h2>
          </div>
          <div className="dialog-body">
            <p id="bulkRemoveSummary" />
            <p className="hint">
              You can restore these books from Recently removed.
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
                Keep books
              </button>
              <button
                id="confirmBulkRemove"
                type="button"
                className="btn danger"
              >
                Remove books
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
