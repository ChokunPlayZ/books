import type { SVGProps } from "react";

const paths = {
  books: "M4 4h4v16H4zM10 6h4v14h-4zM16 4l3-1 4 16-3 1zM4 8h4M10 10h4",
  book: "M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  missing: "M4 4h6v16H4zM14 4h6v4M20 12v4M20 20h-6v-4M14 12V8",
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
  moon: "M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
};

type IconProps = SVGProps<SVGSVGElement> & { name: keyof typeof paths };

export default function Icon({ name, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d={paths[name] || paths.book} />
    </svg>
  );
}
