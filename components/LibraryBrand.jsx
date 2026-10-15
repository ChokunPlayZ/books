import Icon from "./Icon.jsx";

export default function LibraryBrand() {
  return (
    <a className="brand" href="/" aria-label="Book Collection home">
      <span className="brand-mark">
        <Icon name="book" />
      </span>
      <span>
        <span className="brand-name">Book Collection</span>
        <span className="brand-caption">A shelf of your own</span>
      </span>
    </a>
  );
}
