import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { ArrowRight, Bot, Library, Swords, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function DashboardPage() {
  const heroImage = PlaceHolderImages.find((img) => img.id === 'dashboard-hero');
  const promoImages = {
    'deck-builder': PlaceHolderImages.find((img) => img.id === 'deck-builder-promo'),
    'deck-coach': PlaceHolderImages.find((img) => img.id === 'deck-coach-promo'),
    'single-player': PlaceHolderImages.find((img) => img.id === 'single-player-promo'),
    'multiplayer': PlaceHolderImages.find((img) => img.id === 'multiplayer-promo'),
  };

  const features = [
    {
      title: 'Deck Builder',
      description: 'Craft and fine-tune your Commander decks with a powerful editor and vast card library.',
      icon: Library,
      link: '/deck-builder',
      image: promoImages['deck-builder'],
    },
    {
      title: 'AI Deck Coach',
      description: 'Get expert analysis on your deck. The AI coach provides insights on strategy and suggests improvements.',
      icon: Bot,
      link: '/deck-coach',
      image: promoImages['deck-coach'],
    },
    {
      title: 'Single Player',
      description: 'Test your creations against an AI opponent or practice your combos in self-play mode.',
      icon: Swords,
      link: '/single-player',
      image: promoImages['single-player'],
    },
    {
      title: 'Multiplayer',
      description: 'Challenge your friends to a 4-player Commander game. The ultimate battle of wits awaits.',
      icon: Users,
      link: '/multiplayer',
      image: promoImages['multiplayer'],
    },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="relative h-64 w-full overflow-hidden rounded-lg md:rounded-xl" role="banner">
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
            Welcome to Planar Nexus
          </h1>
          <p className="mt-2 max-w-2xl text-lg text-muted-foreground">
            Your command center for epic Magic: The Gathering battles.
          </p>
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6" role="main" aria-label="Dashboard">
        <section aria-labelledby="get-started-heading">
          <h2 id="get-started-heading" className="font-headline text-2xl font-bold">Get Started</h2>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="Features">
            {features.map((feature) => (
              <Card key={feature.title} className="flex flex-col overflow-hidden transition-transform duration-200 hover:scale-[1.02] hover:shadow-lg" role="listitem">
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
                    <feature.icon className="size-6 text-primary" aria-hidden="true" />
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1">
                  <CardDescription>{feature.description}</CardDescription>
                </CardContent>
                <div className="p-6 pt-0">
                  <Button asChild className="w-full">
                    <Link href={feature.link} aria-label={`Go to ${feature.title}`}>
                      Go to {feature.title}
                      <ArrowRight className="ml-2 size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
