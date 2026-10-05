export const metadata = { title: "Ваша выкройка" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f7faf8" }}>{children}</body>
    </html>
  );
}
