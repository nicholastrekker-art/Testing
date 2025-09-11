import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { useToast } from '../hooks/use-toast';

interface ValidateCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ValidateCredentialsModal({ isOpen, onClose }: ValidateCredentialsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [base64Data, setBase64Data] = useState('');
  const [validationMethod, setValidationMethod] = useState('file');
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
    
    // Validate input based on selected method
    if (validationMethod === 'file' && !file) {
      toast({
        title: "No file selected",
        description: "Please select a credentials.json file",
        variant: "destructive",
      });
      return;
    }
    
    if (validationMethod === 'base64' && !base64Data.trim()) {
      toast({
        title: "No session ID provided",
        description: "Please paste your base64 session ID",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      let response;
      
      if (validationMethod === 'file') {
        // File upload method
        const formData = new FormData();
        formData.append('credentials', file!);
        
        response = await fetch('/api/validate-credentials', {
          method: 'POST',
          body: formData,
        });
      } else {
        // Base64 method
        response = await fetch('/api/validate-credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionData: base64Data.trim() }),
        });
      }

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
      setBase64Data('');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>🔍 Validate Session ID</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs value={validationMethod} onValueChange={setValidationMethod} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="file">Upload File</TabsTrigger>
              <TabsTrigger value="base64">Paste Session ID</TabsTrigger>
            </TabsList>
            
            <TabsContent value="file" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="credentials">Upload credentials.json</Label>
                <Input
                  id="credentials"
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
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
            </TabsContent>
            
            <TabsContent value="base64" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sessionData">Paste Base64 Session ID</Label>
                <Textarea
                  id="sessionData"
                  placeholder="Paste your base64 encoded session data here..."
                  value={base64Data}
                  onChange={(e) => setBase64Data(e.target.value)}
                  className="min-h-[120px] font-mono text-xs"
                />
                <p className="text-sm text-muted-foreground">
                  Paste your base64 encoded credentials.json data (session ID)
                </p>
              </div>
              
              {base64Data.trim() && (
                <div className="text-sm text-green-600">
                  ✓ Session data pasted ({base64Data.length} characters)
                </div>
              )}
            </TabsContent>
          </Tabs>
          
          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || (validationMethod === 'file' && !file) || (validationMethod === 'base64' && !base64Data.trim())} 
              className="flex-1"
            >
              {isLoading ? "Validating..." : "Validate"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}