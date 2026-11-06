import Icon from "../Icon";
import { getTranslations } from "../../lib/server/preferences.ts";

export default async function CollectionSpending() {
  const t = await getTranslations();
  return (
    <section
      id="collectionSpending"
      className="collection-spending"
      aria-labelledby="spendingTitle"
    >
      <div className="spending-heading">
        <span className="stat-icon">
          <Icon name="wallet" />
        </span>
        <h2 id="spendingTitle">{t("Collection spending")}</h2>
      </div>
      <p className="hint">
        {t(
          "Total amount paid across your current collection, regardless of filters.",
        )}
      </p>
      <div className="spending-highlights">
        <article className="spending-card">
          <h3>{t("Most expensive series")}</h3>
          <p id="topSeriesName" className="spending-name" />
          <p id="topSeriesAmount" className="spending-amount" />
          <p id="topSeriesNote" className="hint" />
        </article>
        <article className="spending-card">
          <h3>{t("Store with the most spending")}</h3>
          <p id="topStoreName" className="spending-name" />
          <p id="topStoreAmount" className="spending-amount" />
          <p id="topStoreNote" className="hint" />
        </article>
      </div>
      <details className="spending-details">
        <summary>{t("See spending breakdown")}</summary>
        <p id="spendingCoverage" className="hint" />
        <div className="spending-rankings">
          <div>
            <h3>{t("Top 5 series by spending")}</h3>
            <ol id="seriesSpendingList" className="spending-list" />
          </div>
          <div>
            <h3>{t("Top 5 stores by spending")}</h3>
            <ol id="storeSpendingList" className="spending-list" />
          </div>
        </div>
      </details>
      <a className="btn spending-stats-link" href="/stats">
        <Icon name="chart" />
        {t("Explore spending trends")}
      </a>
      <div className="shelf-note">
        <Icon name="book" />
        <p>{t("One volume at a time.")}</p>
        <span>{t("A growing collection of stories you love.")}</span>
      </div>
    </section>
  );
}
