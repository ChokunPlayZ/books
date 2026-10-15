import Icon from "../Icon";

export default function CollectionStats() {
  return (
    <section
      id={"collectionStats"}
      className={"stats"}
      aria-label={"Collection overview"}
    >
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="books" />
        </span>
        <div className={"stat-label"}>{"Books"}</div>
        <div id={"bookCount"} className={"stat-value"}>
          {"—"}
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="grid" />
        </span>
        <div className={"stat-label"}>{"Series"}</div>
        <div id={"seriesCount"} className={"stat-value"}>
          {"—"}
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="check" />
        </span>
        <div className={"stat-label"}>{"Read"}</div>
        <div id={"readCount"} className={"stat-value"}>
          {"—"}
        </div>
        <div id={"readNote"} className={"stat-note"}>
          {"Your reading progress"}
        </div>
        <div className="reading-progress" aria-hidden="true">
          <span id="readProgress" style={{ width: "0%" }} />
        </div>
      </div>
      <div className={"stat"}>
        <span className="stat-icon">
          <Icon name="wallet" />
        </span>
        <div className={"stat-label"}>{"Spent (฿)"}</div>
        <div id={"spent"} className={"stat-value"}>
          {"—"}
        </div>
        <div id={"priceNote"} className={"stat-note"}>
          {"From your recorded purchases"}
        </div>
      </div>
    </section>
  );
}
