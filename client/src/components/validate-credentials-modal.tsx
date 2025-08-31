import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useToast } from '../hooks/use-toast';

interface ValidateCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ValidateCredentialsModal({ isOpen, onClose }: ValidateCredentialsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith('.json')) {
        setFile(selectedFile);
      } else {
        toast({
          title: "Invalid file type",
          description: "Please select a .json file",
          variant: "destructive",
        });
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a credentials.json file",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('credentials', file);

      const response = await fetch('/api/validate-credentials', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok && result.valid) {
        toast({
          title: "✅ Credentials Valid!",
          description: result.message,
        });
      } else {
        toast({
          title: "❌ Invalid Credentials",
          description: result.message,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Validation error",
        description: "Failed to validate credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setFile(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>🔍 Validate WhatsApp Credentials</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credentials">Upload credentials.json</Label>
            <Input
              id="credentials"
              type="file"
              accept=".json"
              onChange={handleFileChange}
              required
            />
            <p className="text-sm text-muted-foreground">
              Upload your WhatsApp session credentials.json file to test if it's valid
            </p>
          </div>
          
          {file && (
            <div className="text-sm text-green-600">
              ✓ Selected: {file.name}
            </div>
          )}
          
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !file} className="flex-1">
              {isLoading ? "Validating..." : "Validate"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}