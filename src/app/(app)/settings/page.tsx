/**
 * Settings Page - API Key Management
 * Issue #47: Create user settings page for API key management
 * 
 * This page provides a UI for managing AI provider API keys,
 * including adding, viewing, validating, and removing keys.
 */

"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Trash2, Check, X, Loader2, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AIProvider } from "@/ai/providers";
import {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  getAllKeyStatus,
  validateApiKey,
  clearAllApiKeys,
  type ProviderKeyStatus,
} from "@/lib/api-key-storage";
import { getAvailableProviders, getModelOptions } from "@/ai/providers";

/**
 * Provider display names
 */
const PROVIDER_NAMES: Record<AIProvider, string> = {
  google: "Google AI (Gemini)",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  custom: "Custom Provider",
};

/**
 * Provider logos/colors
 */
const PROVIDER_COLORS: Record<AIProvider, string> = {
  google: "bg-blue-500",
  openai: "bg-green-500",
  anthropic: "bg-purple-500",
  custom: "bg-gray-500",
};

export default function SettingsPage() {
  // State for API keys
  const [keys, setKeys] = useState<Record<AIProvider, string>>({
    google: "",
    openai: "",
    anthropic: "",
    custom: "",
  });
  const [showKey, setShowKey] = useState<Record<AIProvider, boolean>>({
    google: false,
    openai: false,
    anthropic: false,
    custom: false,
  });
  const [selectedModels, setSelectedModels] = useState<Record<AIProvider, string>>({
    google: "gemini-1.5-flash-latest",
    openai: "gpt-4o-mini",
    anthropic: "claude-3-haiku-20240307",
    custom: "gemini-1.5-flash-latest",
  });
  
  // State for key status
  const [keyStatus, setKeyStatus] = useState<ProviderKeyStatus[]>([]);
  const [isValidating, setIsValidating] = useState<Record<AIProvider, boolean>>({
    google: false,
    openai: false,
    anthropic: false,
    custom: false,
  });
  const [validationResults, setValidationResults] = useState<Record<AIProvider, { valid: boolean; error?: string }>>({
    google: { valid: false },
    openai: { valid: false },
    anthropic: { valid: false },
    custom: { valid: false },
  });
  
  // State for saving
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // State for provider selection
  const [defaultProvider, setDefaultProvider] = useState<AIProvider>("google");
  
  // Load existing keys on mount
  useEffect(() => {
    loadKeys();
  }, []);
  
  async function loadKeys() {
    const providers = getAvailableProviders() as AIProvider[];
    const loadedKeys: Record<AIProvider, string> = {} as Record<AIProvider, string>;
    const statuses = await getAllKeyStatus();
    setKeyStatus(statuses);
    
    for (const provider of providers) {
      const key = await getApiKey(provider);
      loadedKeys[provider] = key || "";
    }
    
    setKeys(loadedKeys);
  }
  
  async function handleSaveKey(provider: AIProvider) {
    const apiKey = keys[provider];
    if (!apiKey.trim()) {
      setValidationResults(prev => ({
        ...prev,
        [provider]: { valid: false, error: "Please enter an API key" },
      }));
      return;
    }
    
    setIsValidating(prev => ({ ...prev, [provider]: true }));
    setSaveMessage(null);
    
    try {
      // Validate the key first
      const result = await validateApiKey(provider, apiKey);
      setValidationResults(prev => ({ ...prev, [provider]: result }));
      
      if (result.valid) {
        // Store the key
        await storeApiKey(provider, apiKey, selectedModels[provider]);
        
        // Update status
        const statuses = await getAllKeyStatus();
        setKeyStatus(statuses);
        
        setSaveMessage({
          type: "success",
          text: `${PROVIDER_NAMES[provider]} key saved and validated successfully!`,
        });
      } else {
        setSaveMessage({
          type: "error",
          text: result.error || "Invalid API key",
        });
      }
    } catch (error) {
      setSaveMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save key",
      });
    } finally {
      setIsValidating(prev => ({ ...prev, [provider]: false }));
    }
  }
  
  async function handleDeleteKey(provider: AIProvider) {
    await deleteApiKey(provider);
    setKeys(prev => ({ ...prev, [provider]: "" }));
    setValidationResults(prev => ({ ...prev, [provider]: { valid: false } }));
    
    const statuses = await getAllKeyStatus();
    setKeyStatus(statuses);
    
    setSaveMessage({
      type: "success",
      text: `${PROVIDER_NAMES[provider]} key removed successfully.`,
    });
  }
  
  async function handleValidate(provider: AIProvider) {
    const apiKey = keys[provider];
    if (!apiKey.trim()) return;
    
    setIsValidating(prev => ({ ...prev, [provider]: true }));
    
    try {
      const result = await validateApiKey(provider, apiKey);
      setValidationResults(prev => ({ ...prev, [provider]: result }));
    } finally {
      setIsValidating(prev => ({ ...prev, [provider]: false }));
    }
  }
  
  async function handleClearAll() {
    if (!confirm("Are you sure you want to remove all API keys? This cannot be undone.")) {
      return;
    }
    
    await clearAllApiKeys();
    setKeys({ google: "", openai: "", anthropic: "", custom: "" });
    setKeyStatus([]);
    setValidationResults({ google: { valid: false }, openai: { valid: false }, anthropic: { valid: false }, custom: { valid: false } });
    
    setSaveMessage({
      type: "success",
      text: "All API keys have been removed.",
    });
  }
  
  const providers = getAvailableProviders() as AIProvider[];
  
  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your AI provider API keys and preferences
        </p>
      </div>
      
      <Tabs defaultValue="api-keys" className="space-y-6">
        <TabsList>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>
        
        <TabsContent value="api-keys" className="space-y-6">
          {/* Save message */}
          {saveMessage && (
            <Alert variant={saveMessage.type === "success" ? "default" : "destructive"}>
              {saveMessage.type === "success" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              <AlertTitle>{saveMessage.type === "success" ? "Success" : "Error"}</AlertTitle>
              <AlertDescription>{saveMessage.text}</AlertDescription>
            </Alert>
          )}
          
          {/* Provider cards */}
          {providers.map((provider) => {
            const status = keyStatus.find(s => s.provider === provider);
            const hasStoredKey = status?.hasKey && keys[provider];
            
            return (
              <Card key={provider}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${PROVIDER_COLORS[provider]}`} />
                    <div>
                      <CardTitle className="text-lg">{PROVIDER_NAMES[provider]}</CardTitle>
                      <CardDescription>
                        {hasStoredKey ? (
                          <span className="text-green-500 flex items-center gap-1">
                            <Check className="w-3 h-3" /> Key configured
                          </span>
                        ) : (
                          "No key configured"
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  {status?.isValid && (
                    <Badge variant="secondary" className="bg-green-500/20 text-green-500">
                      Validated
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Model selection */}
                  <div className="space-y-2">
                    <Label htmlFor={`model-${provider}`}>Model</Label>
                    <Select
                      value={selectedModels[provider]}
                      onValueChange={(value) => setSelectedModels(prev => ({ ...prev, [provider]: value }))}
                    >
                      <SelectTrigger id={`model-${provider}`}>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {getModelOptions(provider).map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* API Key input */}
                  <div className="space-y-2">
                    <Label htmlFor={`key-${provider}`}>API Key</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id={`key-${provider}`}
                          type={showKey[provider] ? "text" : "password"}
                          placeholder={hasStoredKey ? "••••••••••••••••" : `Enter your ${PROVIDER_NAMES[provider]} API key`}
                          value={keys[provider]}
                          onChange={(e) => setKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                          className="pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowKey(prev => ({ ...prev, [provider]: !prev[provider] }))}
                        >
                          {showKey[provider] ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Validation error */}
                    {validationResults[provider]?.error && (
                      <p className="text-sm text-destructive">{validationResults[provider].error}</p>
                    )}
                  </div>
                  
                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSaveKey(provider)}
                      disabled={!keys[provider].trim() || isValidating[provider]}
                    >
                      {isValidating[provider] ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Save & Validate
                    </Button>
                    
                    {hasStoredKey && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => handleValidate(provider)}
                          disabled={isValidating[provider]}
                        >
                          {isValidating[provider] ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          Validate
                        </Button>
                        
                        <Button
                          variant="destructive"
                          onClick={() => handleDeleteKey(provider)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          
          <Separator />
          
          {/* Danger zone */}
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>
                Irreversible actions for your API keys
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={handleClearAll}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear All API Keys
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="providers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Default Provider</CardTitle>
              <CardDescription>
                Select which AI provider to use by default
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={defaultProvider}
                onValueChange={(value) => setDefaultProvider(value as AIProvider)}
              >
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Select default provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => {
                    const status = keyStatus.find(s => s.provider === provider);
                    return (
                      <SelectItem key={provider} value={provider} disabled={!status?.hasKey}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[provider]}`} />
                          {PROVIDER_NAMES[provider]}
                          {!status?.hasKey && (
                            <span className="text-muted-foreground text-xs ml-2">(No key)</span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Provider Status</CardTitle>
              <CardDescription>
                Overview of your configured AI providers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {providers.map((provider) => {
                  const status = keyStatus.find(s => s.provider === provider);
                  const hasKey = status?.hasKey;
                  
                  return (
                    <div key={provider} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${PROVIDER_COLORS[provider]}`} />
                        <span>{PROVIDER_NAMES[provider]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasKey ? (
                          <Badge variant="secondary" className="bg-green-500/20 text-green-500">
                            <Check className="w-3 h-3 mr-1" /> Configured
                          </Badge>
                        ) : (
                          <Badge variant="outline">Not configured</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
