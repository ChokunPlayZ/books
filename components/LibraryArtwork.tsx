export default function LibraryArtwork({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`library-art ${className}`} aria-hidden="true">
      <span className="art-orbit" />
      <div className="art-books">
        <span className="art-book art-book-one">
          <i />I
        </span>
        <span className="art-book art-book-two">
          <i />
          II
        </span>
        <span className="art-book art-book-three">
          <i />
          III
        </span>
        <span className="art-book art-book-four">
          <i />
          IV
        </span>
      </div>
      <span className="art-shelf" />
    </div>
  );
}
