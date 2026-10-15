export default function RemoveDialog() {
  return (
    <dialog id={"removeDialog"} aria-labelledby={"removeTitle"}>
      <div className={"dialog-head"}>
        <div>
          <h2 id={"removeTitle"}>{"Remove from your shelf?"}</h2>
          <p>{"You can restore this book from Recently removed."}</p>
        </div>
        <button
          id={"closeRemove"}
          className={"close"}
          aria-label={"Cancel removal"}
        >
          <svg aria-hidden={"true"}>
            <use href={"#i-close"} />
          </svg>
        </button>
      </div>
      <div className={"dialog-body"}>
        <p id={"removeName"} className={"remove-name"}></p>
        <p className={"hint"}>
          {"Its price will be removed from your collection total."}
        </p>
        <div
          id={"removeError"}
          className={"form-error"}
          role={"alert"}
          hidden
        ></div>
      </div>
      <div className={"dialog-foot"}>
        <div className={"buttons"}>
          <button id={"cancelRemove"} className={"btn"}>
            {"Keep book"}
          </button>
          <button id={"confirmRemove"} className={"btn danger"}>
            {"Remove book"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
