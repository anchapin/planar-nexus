'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MagicFormat, DateRange, getMetaData } from '@/lib/meta';
import DeckArchetypeCard from './DeckArchetypeCard';
import FormatHealthGauge from './FormatHealthGauge';
import ColorDistributionChart from './ColorDistributionChart';
import ArchetypeBalance from './ArchetypeBalance';
import ArchetypeTrends from './ArchetypeTrends';
import CardTrendChart from './CardTrendChart';

export default function MetaOverview() {
  const [selectedFormat, setSelectedFormat] = useState<MagicFormat>('standard');
  const [dateRange, setDateRange] = useState<DateRange>('30days');

  const metaData = getMetaData(selectedFormat, dateRange);

  return (
    <div className="space-y-6">
      {/* Header with Format Selector and Date Range */}
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-2xl">Meta Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs 
              value={selectedFormat} 
              onValueChange={(v) => setSelectedFormat(v as MagicFormat)}
              className="w-full sm:w-auto"
            >
              <TabsList>
                <TabsTrigger value="standard">Standard</TabsTrigger>
                <TabsTrigger value="modern">Modern</TabsTrigger>
                <TabsTrigger value="commander">Commander</TabsTrigger>
              </TabsList>
            </Tabs>
            
            <Select 
              value={dateRange} 
              onValueChange={(v) => setDateRange(v as DateRange)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="alltime">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Format Health Section */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline text-lg">Format Health</CardTitle>
          </CardHeader>
          <CardContent>
            <FormatHealthGauge score={metaData.formatHealth.score} />
          </CardContent>
        </Card>
        
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline text-lg">Color Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ColorDistributionChart data={metaData.formatHealth.colorDistribution} />
          </CardContent>
        </Card>
        
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="font-headline text-lg">Archetype Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <ArchetypeBalance data={metaData.formatHealth.archetypeBalance} />
          </CardContent>
        </Card>
      </div>

      {/* Trend Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-lg">Rising & Declining Archetypes</CardTitle>
          </CardHeader>
          <CardContent>
            <ArchetypeTrends 
              rising={metaData.risingArchetypes} 
              declining={metaData.decliningArchetypes} 
            />
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-lg">Card Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <CardTrendChart data={metaData.cardTrends} />
          </CardContent>
        </Card>
      </div>

      {/* Deck Archetypes Section */}
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-xl">Top Deck Archetypes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {metaData.archetypes.map((archetype) => (
              <DeckArchetypeCard key={archetype.id} archetype={archetype} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
