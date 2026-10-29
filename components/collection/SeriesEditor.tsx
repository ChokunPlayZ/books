export default function SeriesEditor() {
  return (
    <form id="seriesEditor" className="series-editor" hidden>
      <div className="series-editor-heading">
        <h2 id="seriesEditorTitle" tabIndex={-1}>
          Edit volume details
        </h2>
        <p id="seriesEditorHint" className="hint">
          Edit reading status and purchases in the table. Open Book details on
          any row to edit its volume number, ISBN, edition, notes and cover
          links. Save all changes together.
        </p>
      </div>
      <div
        className="series-edit-scroll"
        role="region"
        aria-label="Editable owned volumes"
        aria-describedby="seriesEditorHint"
        tabIndex={0}
      >
        <table className="series-edit-table">
          <caption className="sr-only">Owned volume details</caption>
          <thead>
            <tr>
              <th scope="col">Volume / edition</th>
              <th scope="col">Reading status</th>
              <th scope="col">Purchase date</th>
              <th scope="col">Price paid (฿)</th>
              <th scope="col">Bought from</th>
              <th scope="col">Book details</th>
            </tr>
          </thead>
          <tbody id="seriesEditRows" />
        </table>
      </div>
      <div
        id="seriesSaveBar"
        className="series-save-bar"
        role="region"
        aria-label="Save volume changes"
      >
        <div className="series-save-copy">
          <p id="seriesSaveStatus" role="status" aria-live="polite">
            No unsaved changes
          </p>
          <p id="seriesSaveHint">Your edits stay here until you save.</p>
          <div
            id="seriesEditError"
            className="form-error"
            role="alert"
            hidden
          />
        </div>
        <div className="buttons">
          <button id="cancelSeriesEdit" className="btn" type="button">
            Done
          </button>
          <button
            id="saveSeriesEdits"
            className="btn primary"
            type="submit"
            disabled
          >
            Save changes
          </button>
        </div>
      </div>
    </form>
  );
}
