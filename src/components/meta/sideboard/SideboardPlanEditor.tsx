"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Save } from 'lucide-react';
import { SavedSideboardPlan, saveSideboardPlan, updateSideboardPlan, validateSideboardPlan } from '@/lib/sideboard-plans';
import { SideboardCard } from '@/lib/anti-meta';
import { MagicFormat } from '@/lib/meta';

interface SideboardPlanEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPlan?: SavedSideboardPlan | null;
  defaultValues?: {
    format?: MagicFormat;
    archetypeId?: string;
    archetypeName?: string;
    opponentArchetypeId?: string;
    opponentArchetypeName?: string;
    inCards?: SideboardCard[];
    outCards?: SideboardCard[];
  };
  onSave?: (plan: SavedSideboardPlan) => void;
}

/**
 * Dialog for creating and editing sideboard plans
 */
export function SideboardPlanEditor({ 
  open, 
  onOpenChange, 
  initialPlan,
  defaultValues,
  onSave 
}: SideboardPlanEditorProps) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<MagicFormat>('standard');
  const [archetypeId, setArchetypeId] = useState('');
  const [archetypeName, setArchetypeName] = useState('');
  const [opponentArchetypeId, setOpponentArchetypeId] = useState('');
  const [opponentArchetypeName, setOpponentArchetypeName] = useState('');
  const [inCards, setInCards] = useState<SideboardCard[]>([]);
  const [outCards, setOutCards] = useState<SideboardCard[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // New card input state
  const [newInCard, setNewInCard] = useState({ name: '', count: 1, reason: '' });
  const [newOutCard, setNewOutCard] = useState({ name: '', count: 1, reason: '' });

  // Load initial data
  useEffect(() => {
    if (initialPlan) {
      setName(initialPlan.name);
      setFormat(initialPlan.format);
      setArchetypeId(initialPlan.archetypeId);
      setArchetypeName(initialPlan.archetypeName);
      setOpponentArchetypeId(initialPlan.opponentArchetypeId);
      setOpponentArchetypeName(initialPlan.opponentArchetypeName);
      setInCards(initialPlan.inCards);
      setOutCards(initialPlan.outCards);
      setNotes(initialPlan.notes);
    } else if (defaultValues) {
      setName('');
      setFormat(defaultValues.format || 'standard');
      setArchetypeId(defaultValues.archetypeId || '');
      setArchetypeName(defaultValues.archetypeName || '');
      setOpponentArchetypeId(defaultValues.opponentArchetypeId || '');
      setOpponentArchetypeName(defaultValues.opponentArchetypeName || '');
      setInCards(defaultValues.inCards || []);
      setOutCards(defaultValues.outCards || []);
      setNotes('');
    } else {
      // Reset form
      setName('');
      setFormat('standard');
      setArchetypeId('');
      setArchetypeName('');
      setOpponentArchetypeId('');
      setOpponentArchetypeName('');
      setInCards([]);
      setOutCards([]);
      setNotes('');
    }
    setErrors([]);
  }, [initialPlan, defaultValues, open]);

  // Simple archetype list for the dropdown
  const archetypeOptions = [
    { id: 'std-aggro-red', name: 'Red Aggro' },
    { id: 'std-aggro-white', name: 'White Aggro' },
    { id: 'std-control-blue', name: 'Blue Control' },
    { id: 'std-midrange-black', name: 'Black Midrange' },
    { id: 'std-combo-temur', name: 'Temur Combo' },
    { id: 'std-tempo-blue-red', name: 'Izzet Tempo' },
    { id: 'std-midrange-green', name: 'Green Midrange' },
    { id: 'mod-burn', name: 'Burn' },
    { id: 'mod-jund', name: 'Jund' },
    { id: 'mod-uw-control', name: 'UW Control' },
    { id: 'cmdr-aggro', name: 'Commander Aggro' },
    { id: 'cmdr-control', name: 'Commander Control' },
    { id: 'cmdr-midrange', name: 'Commander Midrange' },
  ];

  const handleAddInCard = () => {
    if (!newInCard.name.trim()) return;
    setInCards([...inCards, { 
      cardName: newInCard.name.trim(), 
      count: newInCard.count, 
      reason: newInCard.reason 
    }]);
    setNewInCard({ name: '', count: 1, reason: '' });
  };

  const handleRemoveInCard = (index: number) => {
    setInCards(inCards.filter((_, i) => i !== index));
  };

  const handleAddOutCard = () => {
    if (!newOutCard.name.trim()) return;
    setOutCards([...outCards, { 
      cardName: newOutCard.name.trim(), 
      count: newOutCard.count, 
      reason: newOutCard.reason 
    }]);
    setNewOutCard({ name: '', count: 1, reason: '' });
  };

  const handleRemoveOutCard = (index: number) => {
    setOutCards(outCards.filter((_, i) => i !== index));
  };

  const handleArchetypeChange = (value: string) => {
    setArchetypeId(value);
    const archetype = archetypeOptions.find(a => a.id === value);
    if (archetype) {
      setArchetypeName(archetype.name);
    }
  };

  const handleOpponentArchetypeChange = (value: string) => {
    setOpponentArchetypeId(value);
    const archetype = archetypeOptions.find(a => a.id === value);
    if (archetype) {
      setOpponentArchetypeName(archetype.name);
    }
  };

  const handleSave = async () => {
    const planData = {
      name: name.trim(),
      format,
      archetypeId,
      archetypeName,
      opponentArchetypeId,
      opponentArchetypeName,
      inCards,
      outCards,
      notes,
    };

    const validation = validateSideboardPlan(planData);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setIsSaving(true);
    try {
      let savedPlan: SavedSideboardPlan;
      
      if (initialPlan) {
        savedPlan = updateSideboardPlan(initialPlan.id, planData) || planData as SavedSideboardPlan;
      } else {
        savedPlan = saveSideboardPlan(planData);
      }
      
      onSave?.(savedPlan);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save sideboard plan:', error);
      setErrors(['Failed to save plan. Please try again.']);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialPlan ? 'Edit Sideboard Plan' : 'Create Sideboard Plan'}</DialogTitle>
          <DialogDescription>
            {initialPlan 
              ? 'Update your custom sideboard plan' 
              : 'Create a custom sideboard plan for your matchups'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <ul className="list-disc list-inside text-sm text-red-600">
                {errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Plan Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., vs Red Aggro"
            />
          </div>

          {/* Format */}
          <div className="space-y-2">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as MagicFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="modern">Modern</SelectItem>
                <SelectItem value="commander">Commander</SelectItem>
                <SelectItem value="legacy">Legacy</SelectItem>
                <SelectItem value="pioneer">Pioneer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Archetypes */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Your Archetype</Label>
              <Select value={archetypeId} onValueChange={handleArchetypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select your deck" />
                </SelectTrigger>
                <SelectContent>
                  {archetypeOptions.map((archetype) => (
                    <SelectItem key={archetype.id} value={archetype.id}>
                      {archetype.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Opponent Archetype</Label>
              <Select value={opponentArchetypeId} onValueChange={handleOpponentArchetypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select opponent" />
                </SelectTrigger>
                <SelectContent>
                  {archetypeOptions.map((archetype) => (
                    <SelectItem key={archetype.id} value={archetype.id}>
                      {archetype.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* In Cards */}
          <div className="space-y-2">
            <Label>Cards to Bring In ({inCards.reduce((sum, c) => sum + c.count, 0)})</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Card name"
                value={newInCard.name}
                onChange={(e) => setNewInCard({ ...newInCard, name: e.target.value })}
                className="flex-1"
              />
              <Input
                type="number"
                min={1}
                max={4}
                value={newInCard.count}
                onChange={(e) => setNewInCard({ ...newInCard, count: parseInt(e.target.value) || 1 })}
                className="w-20"
              />
              <Button type="button" variant="outline" size="icon" onClick={handleAddInCard}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {inCards.map((card, index) => (
                <Badge key={index} variant="outline" className="bg-green-50 pl-2 pr-1 py-1">
                  {card.cardName} x{card.count}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1 text-muted-foreground hover:text-red-500"
                    onClick={() => handleRemoveInCard(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Out Cards */}
          <div className="space-y-2">
            <Label>Cards to Take Out ({outCards.reduce((sum, c) => sum + c.count, 0)})</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Card name"
                value={newOutCard.name}
                onChange={(e) => setNewOutCard({ ...newOutCard, name: e.target.value })}
                className="flex-1"
              />
              <Input
                type="number"
                min={1}
                max={4}
                value={newOutCard.count}
                onChange={(e) => setNewOutCard({ ...newOutCard, count: parseInt(e.target.value) || 1 })}
                className="w-20"
              />
              <Button type="button" variant="outline" size="icon" onClick={handleAddOutCard}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {outCards.map((card, index) => (
                <Badge key={index} variant="outline" className="bg-red-50 pl-2 pr-1 py-1">
                  {card.cardName} x{card.count}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 ml-1 text-muted-foreground hover:text-red-500"
                    onClick={() => handleRemoveOutCard(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about this matchup..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SideboardPlanEditor;
