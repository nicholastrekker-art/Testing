import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface CredentialUpdateModalProps {
  open: boolean;
  onClose: () => void;
  botId: string;
  phoneNumber: string;
  onSuccess?: () => void;
  crossTenancyMode?: boolean;
  targetServer?: string;
}

export default function CredentialUpdateModal({ 
  open, 
  onClose, 
  botId, 
  phoneNumber,
  onSuccess,
  crossTenancyMode = false,
  targetServer
}: CredentialUpdateModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [credentialType, setCredentialType] = useState<'base64' | 'file'>('base64');
  const [sessionId, setSessionId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [crossTenancyResult, setCrossTenancyResult] = useState<any>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.json')) {
        toast({
          title: "Invalid File",
          description: "Please select a valid .json file",
          variant: "destructive"
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (credentialType === 'base64' && !sessionId.trim()) {
      toast({
        title: "Missing Credentials",
        description: "Please provide a Base64 session ID",
        variant: "destructive"
      });
      return;
    }
    
    if (credentialType === 'file' && !selectedFile) {
      toast({
        title: "Missing File", 
        description: "Please select a credentials file",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('phoneNumber', phoneNumber);
      formData.append('action', 'update_credentials');
      formData.append('credentialType', credentialType);
      
      // Add botId only for same-server operations
      if (!crossTenancyMode) {
        formData.append('botId', botId);
      }
      
      // Add target server for cross-tenancy operations
      if (crossTenancyMode && targetServer) {
        formData.append('targetServer', targetServer);
      }
      
      if (credentialType === 'base64') {
        formData.append('sessionId', sessionId);
      } else if (selectedFile) {
        formData.append('credsFile', selectedFile);
      }

      // Use cross-tenancy endpoint if in cross-tenancy mode
      const endpoint = crossTenancyMode ? '/api/guest/cross-tenancy-manage' : '/api/guest/manage-bot';
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        // Handle cross-tenancy response differently
        if (data.crossTenancy && data.nextSteps) {
          setCrossTenancyResult(data);
          toast({
            title: "Cross-Tenancy Update Initiated!",
            description: data.message
          });
        } else {
          toast({
            title: "Success!",
            description: data.message
          });
          
          // Reset form for regular updates
          setSessionId('');
          setSelectedFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          
          onSuccess?.();
          onClose();
        }
      } else {
        toast({
          title: "Update Failed",
          description: data.message || "Failed to update credentials",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error updating credentials:', error);
      toast({
        title: "Network Error",
        description: "Failed to connect to server. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setSessionId('');
      setSelectedFile(null);
      setCrossTenancyResult(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            🔑 {crossTenancyMode ? 'Cross-Tenancy' : ''} Update Bot Credentials
          </DialogTitle>
          <DialogDescription>
            {crossTenancyMode 
              ? `Update credentials across servers (Target: ${targetServer})`
              : 'Update your WhatsApp bot credentials to restore connectivity'
            }
          </DialogDescription>
        </DialogHeader>

        {crossTenancyResult ? (
          <div className="space-y-4">
            {/* Cross-Tenancy Success Display */}
            <Card className="bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-emerald-600 dark:text-emerald-400 text-lg">✅</span>
                  <h4 className="font-medium text-emerald-800 dark:text-emerald-200">
                    Cross-Tenancy Update Successful!
                  </h4>
                </div>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-3">
                  {crossTenancyResult.message}
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="font-medium">Source:</span>
                    <div className="text-muted-foreground">{crossTenancyResult.sourceServer}</div>
                  </div>
                  <div>
                    <span className="font-medium">Target:</span>
                    <div className="text-emerald-600 dark:text-emerald-400 font-medium">{crossTenancyResult.targetServer}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Next Steps */}
            <Card className="bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
              <CardContent className="p-4">
                <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-3 flex items-center gap-2">
                  🎯 Next Steps
                </h4>
                <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-2">
                  {crossTenancyResult.nextSteps?.map((step: string, index: number) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      {step}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Button onClick={handleClose} className="w-full">
              ✨ Awesome! Got It
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Information Card */}
            <Card className={`${crossTenancyMode ? 'bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-800' : 'bg-blue-50 border-blue-200'}`}>
              <CardContent className="p-3">
                <p className={`text-sm ${crossTenancyMode ? 'text-purple-800 dark:text-purple-200' : 'text-blue-800'}`}>
                  <strong>📱 Phone:</strong> {phoneNumber}
                  {crossTenancyMode && (
                    <>
                      <br />
                      <strong>🌐 Target Server:</strong> {targetServer}
                    </>
                  )}
                </p>
                <p className={`text-xs mt-1 ${crossTenancyMode ? 'text-purple-600 dark:text-purple-300' : 'text-blue-600'}`}>
                  {crossTenancyMode 
                    ? 'Credentials will be transferred to the target server'
                    : 'New credentials must match this phone number'
                  }
                </p>
              </CardContent>
            </Card>

          {/* Credential Type Selection */}
          <div>
            <Label className="text-base font-medium">Choose Credential Type *</Label>
            <RadioGroup 
              value={credentialType} 
              onValueChange={(value: 'base64' | 'file') => setCredentialType(value)}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="base64" id="base64" />
                <Label htmlFor="base64">Paste Base64 Session ID</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="file" id="file" />
                <Label htmlFor="file">Upload creds.json File</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Credential Input */}
          {credentialType === 'base64' ? (
            <div>
              <Label htmlFor="sessionId">Base64 Session ID *</Label>
              <Textarea
                id="sessionId"
                placeholder="Paste your Base64 encoded session here..."
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="min-h-[100px] text-xs"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Get this from your WhatsApp session backup
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="credsFile">Upload creds.json File *</Label>
              <Input
                id="credsFile"
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                ref={fileInputRef}
                required
              />
              {selectedFile && (
                <p className="text-xs text-green-600 mt-1">
                  ✅ Selected: {selectedFile.name}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Select the creds.json file from your bot session
              </p>
            </div>
          )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading}
                className={`flex-1 ${crossTenancyMode ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700' : ''}`}
              >
                {isLoading 
                  ? 'Updating...' 
                  : crossTenancyMode 
                    ? '🔄 Update Cross-Tenancy' 
                    : 'Update Credentials'
                }
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}