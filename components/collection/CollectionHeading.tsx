import LibraryArtwork from "../LibraryArtwork";

export default function CollectionHeading({
  removed = false,
}: {
  removed?: boolean;
}) {
  return (
    <div id="collectionHeading" className="collection-heading">
      <div>
        <p className="eyebrow">Your personal library</p>
        <h1 id="collectionTitle">
          {removed ? "Recently removed" : "Your collection"}
          <span className="heading-dot">.</span>
        </h1>
        <p id="collectionIntro" className="intro">
          {removed
            ? "A place to find the books you’ve set aside. Restore them whenever you like."
            : "Every story, every volume. All in one place."}
        </p>
      </div>
      <LibraryArtwork className="heading-art" />
    </div>
  );
}
