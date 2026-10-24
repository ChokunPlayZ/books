export default function CollectionHeading({
  removed = false,
}: {
  removed?: boolean;
}) {
  return (
    <div id="collectionHeading" className="collection-heading">
      <div>
        <h1 id="collectionTitle">
          {removed ? "Recently removed" : "Your collection"}
        </h1>
        <p id="collectionIntro" className="intro">
          {removed
            ? "A place to find the books you’ve set aside. Restore them whenever you like."
            : "Manga, light novels, and every volume you own."}
        </p>
      </div>
    </div>
  );
}
