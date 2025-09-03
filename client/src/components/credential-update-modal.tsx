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
}

export default function CredentialUpdateModal({ 
  open, 
  onClose, 
  botId, 
  phoneNumber,
  onSuccess 
}: CredentialUpdateModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [credentialType, setCredentialType] = useState<'base64' | 'file'>('base64');
  const [sessionId, setSessionId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
      formData.append('botId', botId);
      formData.append('credentialType', credentialType);
      
      if (credentialType === 'base64') {
        formData.append('sessionId', sessionId);
      } else if (selectedFile) {
        formData.append('credsFile', selectedFile);
      }

      const response = await fetch('/api/guest/manage-bot', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Success!",
          description: data.message
        });
        
        // Reset form
        setSessionId('');
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        
        onSuccess?.();
        onClose();
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
          <DialogTitle>🔑 Update Bot Credentials</DialogTitle>
          <DialogDescription>
            Update your WhatsApp bot credentials to restore connectivity
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Information Card */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-3">
              <p className="text-sm text-blue-800">
                <strong>📱 Phone:</strong> {phoneNumber}
              </p>
              <p className="text-xs text-blue-600 mt-1">
                New credentials must match this phone number
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
              className="flex-1"
            >
              {isLoading ? 'Updating...' : 'Update Credentials'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}