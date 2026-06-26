import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { ArrowRight, Bot, Library, Swords, Users, Eye } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function DashboardPage() {
  const t = useTranslations("dashboard");

  const heroImage = PlaceHolderImages.find(
    (img) => img.id === "dashboard-hero",
  );
  const promoImages = {
    "deck-builder": PlaceHolderImages.find(
      (img) => img.id === "deck-builder-promo",
    ),
    "deck-coach": PlaceHolderImages.find(
      (img) => img.id === "deck-coach-promo",
    ),
    "single-player": PlaceHolderImages.find(
      (img) => img.id === "single-player-promo",
    ),
    multiplayer: PlaceHolderImages.find(
      (img) => img.id === "multiplayer-promo",
    ),
    spectator: PlaceHolderImages.find((img) => img.id === "spectator-promo"),
  };

  const features = [
    {
      key: "deckBuilder",
      icon: Library,
      link: "/deck-builder",
      image: promoImages["deck-builder"],
    },
    {
      key: "aiDeckCoach",
      icon: Bot,
      link: "/deck-coach",
      image: promoImages["deck-coach"],
    },
    {
      key: "singlePlayer",
      icon: Swords,
      link: "/single-player",
      image: promoImages["single-player"],
    },
    {
      key: "spectator",
      icon: Eye,
      link: "/spectator",
      image: promoImages["spectator"],
    },
    {
      key: "multiplayer",
      icon: Users,
      link: "/multiplayer",
      image: promoImages["multiplayer"],
    },
  ] as const;

  return (
    <div className="flex flex-1 flex-col">
      <header
        className="relative h-64 w-full overflow-hidden rounded-lg md:rounded-xl"
        role="banner"
      >
        {heroImage && (
          <Image
            src={heroImage.imageUrl}
            alt={heroImage.description}
            fill
            className="object-cover"
            data-ai-hint={heroImage.imageHint}
            priority
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute bottom-0 left-0 p-6 md:p-8">
          <h1 className="font-headline text-3xl font-bold text-foreground md:text-5xl">
            {t("welcomeHeading")}
          </h1>
          <p className="mt-2 max-w-2xl text-lg text-muted-foreground">
            {t("welcomeSubtitle")}
          </p>
        </div>
      </header>
      <main
        className="flex-1 p-4 md:p-6"
        role="main"
        aria-label={t("welcomeHeading")}
      >
        <section aria-labelledby="get-started-heading">
          <h2
            id="get-started-heading"
            className="font-headline text-2xl font-bold"
          >
            {t("getStarted")}
          </h2>
          <div
            className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
            role="list"
            aria-label={t("getStarted")}
          >
            {features.map((feature) => {
              const title = t(`features.${feature.key}.title`);
              const description = t(`features.${feature.key}.description`);
              return (
                <Card
                  key={feature.key}
                  className="flex flex-col overflow-hidden transition-transform duration-200 hover:scale-[1.02] hover:shadow-lg"
                  role="listitem"
                >
                  {feature.image && (
                    <div className="relative h-40 w-full">
                      <Image
                        src={feature.image.imageUrl}
                        alt={feature.image.description}
                        fill
                        className="object-cover"
                        data-ai-hint={feature.image.imageHint}
                      />
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-headline">
                      <feature.icon
                        className="size-6 text-primary"
                        aria-hidden="true"
                      />
                      {title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <CardDescription>{description}</CardDescription>
                  </CardContent>
                  <div className="p-6 pt-0">
                    <Button asChild className="w-full">
                      <Link
                        href={feature.link}
                        aria-label={t("goTo", { title })}
                      >
                        {t("goTo", { title })}
                        <ArrowRight
                          className="ml-2 size-4"
                          aria-hidden="true"
                        />
                      </Link>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
