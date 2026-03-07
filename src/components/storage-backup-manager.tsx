/**
 * @fileOverview Storage Backup Manager Component
 *
 * Unit 16: Local Storage Migration
 *
 * Provides:
 * - UI for exporting user data
 * - UI for importing backups
 * - Storage quota display
 * - Data management controls
 */

"use client";

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  Upload,
  Trash2,
  HardDrive,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import {
  useStorageBackup,
  validateBackupFile,
  getBackupMetadata,
} from '@/hooks/use-storage-backup';

/**
 * Storage Backup Manager Component
 */
export function StorageBackupManager() {
  const {
    status,
    progress,
    error,
    quota,
    isInitialized,
    exportData,
    importData,
    clearAllData,
    loadStorageQuota,
    reset,
    isProcessing,
    isComplete,
    isApproachingLimit,
    storageUsage,
    storageQuota,
    storagePercentage,
  } = useStorageBackup();

  const [importFile, setImportFile] = useState<File | null>(null);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    await exportData();
    setTimeout(() => reset(), 3000);
  };

  const handleImport = async () => {
    if (!importFile) return;

    const isValid = await validateBackupFile(importFile);
    if (!isValid) {
      alert('Invalid backup file. Please select a valid Planar Nexus backup.');
      return;
    }

    await importData(importFile);
    setTimeout(() => reset(), 3000);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
    }
  };

  const handleClearData = async () => {
    await clearAllData();
    setShowConfirmClear(false);
    setTimeout(() => reset(), 3000);
  };

  const handleReset = () => {
    reset();
    setImportFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!isInitialized) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Storage & Backup
        </CardTitle>
        <CardDescription>
          Manage your data, create backups, and restore from backups
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
            <TabsTrigger value="restore">Restore</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Storage Usage</span>
                <span className="font-medium">
                  {storageUsage} / {storageQuota}
                </span>
              </div>
              <Progress value={parseFloat(storagePercentage)} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{storagePercentage}% used</span>
                {isApproachingLimit && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Approaching limit
                  </Badge>
                )}
              </div>
            </div>

            <Alert>
              <HardDrive className="h-4 w-4" />
              <AlertTitle>Storage Information</AlertTitle>
              <AlertDescription>
                Your data is stored locally using IndexedDB, which provides better
                performance and larger storage capacity than localStorage. You can
                export your data at any time to create a backup file.
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* Backup Tab */}
          <TabsContent value="backup" className="space-y-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Export Data</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create a backup file containing all your decks, saved games, and
                  preferences.
                </p>
                <Button
                  onClick={handleExport}
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Export Backup
                    </>
                  )}
                </Button>
              </div>

              {isComplete && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Export Complete</AlertTitle>
                  <AlertDescription>
                    Your backup has been downloaded successfully.
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Export Failed</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              )}

              {progress > 0 && progress < 100 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </div>
              )}
            </div>
          </TabsContent>

          {/* Restore Tab */}
          <TabsContent value="restore" className="space-y-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Import Backup</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Restore your data from a previously created backup file.
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="backup-file-input"
                />

                <label htmlFor="backup-file-input">
                  <Button
                    variant="outline"
                    className="w-full cursor-pointer"
                    asChild
                  >
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      Select Backup File
                    </span>
                  </Button>
                </label>

                {importFile && (
                  <div className="mt-4 p-4 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{importFile.name}</span>
                      <Badge variant="secondary">
                        {getBackupMetadata(importFile).formattedSize}
                      </Badge>
                    </div>
                    <Button
                      onClick={handleImport}
                      disabled={isProcessing}
                      className="w-full"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Import Backup
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {isComplete && (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>Import Complete</AlertTitle>
                    <AlertDescription>
                      Your data has been restored successfully.
                    </AlertDescription>
                  </Alert>
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Import Failed</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                )}

                {progress > 0 && progress < 100 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Progress</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-medium mb-2 text-destructive">
                  Danger Zone
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Clear all stored data. This action cannot be undone.
                </p>

                <Dialog open={showConfirmClear} onOpenChange={setShowConfirmClear}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="w-full">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear All Data
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Clear All Data?</DialogTitle>
                      <DialogDescription>
                        This will permanently delete all your decks, saved games,
                        and preferences. This action cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowConfirmClear(false)}>
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={handleClearData}>
                        Clear All Data
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {status === 'error' && (
          <div className="mt-4 flex justify-end">
            <Button onClick={handleReset} variant="outline" size="sm">
              Reset
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
