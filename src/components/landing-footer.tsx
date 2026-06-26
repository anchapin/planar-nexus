import { useTranslations } from "next-intl";

export function LandingFooter() {
  const t = useTranslations("footer");
  const tCommon = useTranslations("common");

  return (
    <footer className="border-t bg-muted/20 py-8 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p className="font-medium text-foreground">{tCommon("appName")}</p>
            <p>{tCommon("tagline")}</p>
          </div>

          <div className="flex flex-col items-center md:items-end gap-1">
            <a
              href="https://company.wizards.com/en/legal/fancontentpolicy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {t("wizardsFanContentPolicy")}
            </a>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
          <p>{t("legal")}</p>
        </div>
      </div>
    </footer>
  );
}
