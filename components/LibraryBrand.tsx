import Icon from "./Icon";

export default function LibraryBrand() {
  return (
    <a
      className="brand flex shrink-0 items-center no-underline"
      href="/"
      aria-label="Book Collection home"
    >
      <span className="brand-mark">
        <Icon name="book" />
      </span>
      <span>
        <span className="brand-name">Book Collection</span>
      </span>
    </a>
  );
}
