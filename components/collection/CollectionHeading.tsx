import LibraryArtwork from "../LibraryArtwork";

export default function CollectionHeading() {
  return (
    <div id="collectionHeading" className="collection-heading">
      <div>
        <p className="eyebrow">Your personal library</p>
        <h1 id="collectionTitle">
          Your collection<span className="heading-dot">.</span>
        </h1>
        <p id="collectionIntro" className="intro">
          Every story, every volume. All in one place.
        </p>
      </div>
      <LibraryArtwork className="heading-art" />
    </div>
  );
}
