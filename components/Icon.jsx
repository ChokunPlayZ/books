const paths = {
  books: "M4 4h4v16H4zM10 6h4v14h-4zM16 4l3-1 4 16-3 1zM4 8h4M10 10h4",
  book: "M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  check: "m5 12 4 4L19 6",
  wallet: "M20 7H4V4h14v3M4 7v13h16V7M20 11h-6v5h6",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
  compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 8l-2 6-6 2 2-6Z",
  archive: "M4 4h16v4H4zM5 8v12h14V8M10 12h4",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  arrow: "M19 12H5m6-6-6 6 6 6",
  lock: "M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3",
  logout: "M9 4H4v16h5m5-13 5 5-5 5M8 12h12",
};

export default function Icon({ name, ...props }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d={paths[name] || paths.book} />
    </svg>
  );
}
