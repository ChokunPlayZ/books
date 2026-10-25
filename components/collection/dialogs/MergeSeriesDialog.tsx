export default function MergeSeriesDialog() {
  return (
    <dialog
      id="mergeSeriesDialog"
      aria-labelledby="mergeSeriesTitle"
      aria-describedby="mergeSeriesSummary"
    >
      <div className="dialog-head">
        <div>
          <h2 id="mergeSeriesTitle">Merge series</h2>
          <p>Bring volumes listed under different names into one series.</p>
        </div>
        <button
          id="closeMergeSeries"
          type="button"
          className="close"
          aria-label="Close merge series"
        >
          <svg aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      </div>
      <form id="mergeSeriesForm">
        <div className="dialog-body">
          <div
            id="mergeSeriesError"
            className="form-error"
            role="alert"
            hidden
          />
          <p id="mergeSeriesSummary" />
          <ul id="mergeSeriesPreview" className="merge-series-preview" />
          <div className="field">
            <label htmlFor="mergeSeriesName">Series name to keep</label>
            <select id="mergeSeriesName" required />
          </div>
          <p className="hint">
            Includes all owned volumes in these series, even those hidden by
            filters. Each book keeps its edition, ISBN, cover, reading status
            and purchase details. Multiple copies of the same volume stay
            separate.
          </p>
          <p className="hint">
            If catalog choices overlap, the kept name’s choice takes priority.
          </p>
        </div>
        <div className="dialog-foot">
          <div className="buttons">
            <button id="cancelMergeSeries" type="button" className="btn">
              Cancel
            </button>
            <button
              id="confirmMergeSeries"
              type="submit"
              className="btn primary"
            >
              Merge series
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
