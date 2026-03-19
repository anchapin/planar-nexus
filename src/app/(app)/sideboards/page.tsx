"use client";

import React, { useState, useEffect } from 'react';
import { SideboardPlanCard, SideboardPlanEditor } from '@/components/meta/sideboard';
import { getAllSideboardPlans, deleteSideboardPlan, SavedSideboardPlan } from '@/lib/sideboard-plans';
import { MagicFormat } from '@/lib/meta';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Shield } from 'lucide-react';

export default function SideboardsPage() {
  const [plans, setPlans] = useState<SavedSideboardPlan[]>([]);
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SavedSideboardPlan | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SavedSideboardPlan | null>(null);

  // Load plans on mount
  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = () => {
    const allPlans = getAllSideboardPlans();
    setPlans(allPlans.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ));
  };

  const filteredPlans = formatFilter === 'all' 
    ? plans 
    : plans.filter(plan => plan.format === formatFilter);

  const handleDelete = (plan: SavedSideboardPlan) => {
    if (confirm(`Delete "${plan.name}"? This cannot be undone.`)) {
      deleteSideboardPlan(plan.id);
      loadPlans();
      if (selectedPlan?.id === plan.id) {
        setSelectedPlan(null);
      }
    }
  };

  const handleEdit = (plan: SavedSideboardPlan) => {
    setEditingPlan(plan);
    setEditorOpen(true);
  };

  const handleSave = () => {
    loadPlans();
    setEditingPlan(null);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="container mx-auto py-6 px-4 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">My Sideboard Plans</h1>
            <p className="text-muted-foreground mt-1">
              Manage your custom sideboard configurations
            </p>
          </div>
          <Button onClick={() => { setEditingPlan(null); setEditorOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Plan
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-48">
            <Select value={formatFilter} onValueChange={setFormatFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Formats</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="modern">Modern</SelectItem>
                <SelectItem value="commander">Commander</SelectItem>
                <SelectItem value="legacy">Legacy</SelectItem>
                <SelectItem value="pioneer">Pioneer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground">
            {filteredPlans.length} plan{filteredPlans.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Plans Grid */}
        {filteredPlans.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPlans.map((plan) => (
              <SideboardPlanCard
                key={plan.id}
                plan={plan}
                onView={setSelectedPlan}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                No Sideboard Plans Yet
              </CardTitle>
              <CardDescription>
                Create custom sideboard plans or save recommendations from the meta page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => { setEditingPlan(null); setEditorOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Plan
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sideboard Plan Editor */}
      <SideboardPlanEditor
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditingPlan(null);
        }}
        initialPlan={editingPlan}
        onSave={handleSave}
      />
    </div>
  );
}
