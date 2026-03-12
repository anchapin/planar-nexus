/**
 * Settings Page - Application Settings
 *
 * This page provides settings for:
 * - Card Images
 * - Sound
 * - Auto-Save
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { SoundSettings } from "@/components/sound-settings";
import { AutoSaveSettings } from "@/components/auto-save-settings";
import {
  getImageDirectory,
  setImageDirectory,
  clearImageDirectory,
  isCustomImagesEnabled,
  validateImageDirectory,
} from "@/lib/card-image-resolver";

export default function SettingsPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="mb-10">
        <h1 className="text-4xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Configure your Planar Nexus experience
        </p>
      </div>

      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Card Database</CardTitle>
            <CardDescription>
              Import and manage your card database
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/database-management">
                Manage Database
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="card-images" className="space-y-6">
        <TabsList>
          <TabsTrigger value="card-images">Card Images</TabsTrigger>
          <TabsTrigger value="sound">Sound</TabsTrigger>
          <TabsTrigger value="auto-save">Auto-Save</TabsTrigger>
        </TabsList>

        <TabsContent value="card-images" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Card Images</CardTitle>
              <CardDescription>
                Configure your own card images to avoid legal issues with WotC
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertTitle>Bring Your Own Images</AlertTitle>
                <AlertDescription>
                  Planar Nexus follows the Cockatrice/XMage model - you must provide your own card images.
                  This protects the project from legal issues. Card data (names, text, rules) is still fetched from Scryfall.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="image-dir">Image Directory Path</Label>
                <Input
                  id="image-dir"
                  placeholder="e.g., C:/MTGImages or /path/to/images"
                  defaultValue={getImageDirectory() || ''}
                  onBlur={(e) => {
                    const path = e.target.value;
                    if (path) {
                      const validation = validateImageDirectory(path);
                      if (validation.valid) {
                        setImageDirectory(path);
                      }
                    }
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  Enter the path to your card images folder. Images should be organized as: {'{dir}/{set}/{number}.jpg'}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="enable-images">Enable Custom Images</Label>
                </div>
                <Switch
                  id="enable-images"
                  checked={isCustomImagesEnabled()}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      clearImageDirectory();
                    }
                  }}
                />
              </div>

              <Separator />

              <div>
                <h4 className="font-medium mb-2">How to get card images</h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Download card images from <a href="https://scryfall.com/docs/bulk-data" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Scryfall Bulk Data</a></li>
                  <li>Organize images by set (e.g., m21/, eld/, etc.)</li>
                  <li>Name files by collector number (e.g., 242.jpg)</li>
                  <li>Enter the folder path above</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sound" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sound Settings</CardTitle>
              <CardDescription>
                Configure game sounds and music volume
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SoundSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auto-save" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Auto-Save Settings</CardTitle>
              <CardDescription>
                Configure automatic game saving
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AutoSaveSettings />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
