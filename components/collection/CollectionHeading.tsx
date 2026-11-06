import { getTranslations } from "../../lib/server/preferences.ts";

export default async function CollectionHeading({
  removed = false,
}: {
  removed?: boolean;
}) {
  const t = await getTranslations();
  return (
    <div id="collectionHeading" className="collection-heading">
      <div>
        <h1 id="collectionTitle">
          {t(removed ? "Recently removed" : "Your collection")}
        </h1>
        <p id="collectionIntro" className="intro">
          {t(
            removed
              ? "A place to find the books you’ve set aside. Restore them whenever you like."
              : "Manga, light novels, and every volume you own.",
          )}
        </p>
      </div>
    </div>
  );
}
