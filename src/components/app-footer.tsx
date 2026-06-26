import { useTranslations } from "next-intl";

export function AppFooter() {
  const t = useTranslations("footer");

  return (
    <footer className="border-t bg-muted/10 py-2 px-4">
      <div className="flex flex-col md:flex-row justify-between items-center gap-2 text-xs text-muted-foreground">
        <p>{t("appTagline")}</p>
        <p>{t("legal")}</p>
      </div>
    </footer>
  );
}
