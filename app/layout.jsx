import "./globals.css";
export const metadata = {
  title: "Book Collection",
  description:
    "Your personal library of manga, light novels and every volume in between.",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
