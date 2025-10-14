import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertBotInstanceSchema } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef } from "react";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formSchema = insertBotInstanceSchema.extend({
  credentialsFile: z.any().optional(),
  credentialsBase64: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface AddBotModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AddBotModal({ open, onClose }: AddBotModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [base64Credentials, setBase64Credentials] = useState<string>("");
  const [uploadMethod, setUploadMethod] = useState<"file" | "base64">("file");

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      autoViewStatus: true,
      typingMode: "none",
      chatgptEnabled: false,
    },
  });

  const createBotMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (key !== 'credentialsFile' && key !== 'credentialsBase64') {
          formData.append(key, String(value));
        }
      });
      
      // Append file if selected (file upload method)
      if (uploadMethod === "file" && selectedFile) {
        formData.append('credentials', selectedFile);
      }
      
      // Append base64 credentials if provided (base64 method)
      if (uploadMethod === "base64" && base64Credentials.trim()) {
        formData.append('credentialsBase64', base64Credentials.trim());
      }

      const response = await fetch("/api/bot-instances", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create bot instance");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Bot instance created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      form.reset();
      setSelectedFile(null);
      setBase64Credentials("");
      onClose();
    },
    onError: (error) => {
      toast({ 
        title: "Failed to create bot instance", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file type
      if (!file.name.endsWith('.json')) {
        toast({ 
          title: "Invalid file type", 
          description: "Please select a valid JSON file",
          variant: "destructive" 
        });
        return;
      }

      // Check file size (minimum 10 bytes, maximum 5MB)
      if (file.size < 10) {
        toast({ 
          title: "File too small", 
          description: "The credentials file appears to be empty or invalid",
          variant: "destructive" 
        });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({ 
          title: "File too large", 
          description: "Credentials file must be smaller than 5MB",
          variant: "destructive" 
        });
        return;
      }

      // Validate JSON content
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = JSON.parse(content);
          
          // Check if it looks like a valid credentials file
          if (typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) {
            throw new Error('Invalid credentials format');
          }

          // Check for essential fields (basic validation)
          if (Object.keys(parsed).length === 0) {
            throw new Error('Credentials file is empty');
          }

          setSelectedFile(file);
          toast({ 
            title: "File validated", 
            description: "Credentials file looks valid",
            variant: "default" 
          });
        } catch (error) {
          toast({ 
            title: "Invalid JSON file", 
            description: "The file contains invalid JSON or is not a proper credentials file",
            variant: "destructive" 
          });
          setSelectedFile(null);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleBase64Input = (value: string) => {
    setBase64Credentials(value);
    
    if (value.trim()) {
      try {
        // Decode base64 and validate JSON
        const decoded = atob(value.trim());
        const parsed = JSON.parse(decoded);
        
        // Check if it looks like a valid credentials file
        if (typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) {
          throw new Error('Invalid credentials format');
        }

        // Check for essential fields (basic validation)
        if (Object.keys(parsed).length === 0) {
          throw new Error('Credentials file is empty');
        }

        toast({ 
          title: "Base64 credentials validated", 
          description: "Credentials data looks valid",
          variant: "default" 
        });
      } catch (error) {
        toast({ 
          title: "Invalid base64 credentials", 
          description: "Please check that your base64 string contains valid JSON credentials",
          variant: "destructive" 
        });
      }
    }
  };

  const onSubmit = (data: FormData) => {
    createBotMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md" data-testid="modal-add-bot">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground">Add New Bot Instance</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
              Bot Name
            </Label>
            <Input
              id="name"
              placeholder="Enter bot name..."
              {...form.register("name")}
              className="w-full bg-input border-border text-foreground placeholder:text-muted-foreground"
              data-testid="input-bot-name"
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive mt-1">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div>
            <Label className="block text-sm font-medium text-foreground mb-2">
              Credentials
            </Label>
            <Tabs value={uploadMethod} onValueChange={(value) => setUploadMethod(value as "file" | "base64")} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="file">Upload File</TabsTrigger>
                <TabsTrigger value="base64">Paste Base64</TabsTrigger>
              </TabsList>
              
              <TabsContent value="file" className="mt-4">
                <div 
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-credentials"
                >
                  <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                    <i className="fas fa-upload text-muted-foreground text-xl"></i>
                  </div>
                  <p className="text-sm text-foreground font-medium">
                    {selectedFile ? selectedFile.name : "Click to upload creds.json"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    or drag and drop your credentials file
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-credentials-file"
                />
              </TabsContent>
              
              <TabsContent value="base64" className="mt-4">
                <div className="space-y-2">
                  <Textarea
                    placeholder="Paste your base64-encoded credentials here..."
                    value={base64Credentials}
                    onChange={(e) => handleBase64Input(e.target.value)}
                    className="min-h-[120px] bg-input border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
                    data-testid="textarea-base64-credentials"
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste the base64-encoded version of your creds.json file. The bot will decode and validate it automatically.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="block text-sm font-medium text-foreground mb-2">
                Auto Features
              </Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoViewStatus"
                    checked={form.watch("autoViewStatus") || false}
                    onCheckedChange={(checked) => form.setValue("autoViewStatus", checked as boolean)}
                    data-testid="checkbox-auto-view-status"
                  />
                  <Label htmlFor="autoViewStatus" className="text-sm text-foreground">Auto View Status</Label>
                </div>
              </div>
            </div>

            <div>
              <Label className="block text-sm font-medium text-foreground mb-2">
                Typing Indicator
              </Label>
              <p className="text-xs text-muted-foreground mb-2">Show typing/recording when bot processes messages</p>
              <Select value={form.watch("typingMode") || "none"} onValueChange={(value) => form.setValue("typingMode", value)}>
                <SelectTrigger className="w-full bg-input border-border text-foreground" data-testid="select-typing-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="typing">Typing indicator</SelectItem>
                  <SelectItem value="recording">Recording indicator</SelectItem>
                  <SelectItem value="both">Switch between both</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="block text-sm font-medium text-foreground mb-2">
                Presence Mode
              </Label>
              <p className="text-xs text-muted-foreground mb-2">Control bot's overall online/availability status</p>
              <Select value={form.watch("presenceMode") || "available"} onValueChange={(value) => form.setValue("presenceMode", value)}>
                <SelectTrigger className="w-full bg-input border-border text-foreground" data-testid="select-presence-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="available">Available (Online)</SelectItem>
                  <SelectItem value="unavailable">Unavailable (Offline)</SelectItem>
                  <SelectItem value="composing">Composing</SelectItem>
                  <SelectItem value="recording">Recording</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="chatgptEnabled"
              checked={form.watch("chatgptEnabled") || false}
              onCheckedChange={(checked) => form.setValue("chatgptEnabled", checked as boolean)}
              data-testid="checkbox-chatgpt-enabled"
            />
            <Label htmlFor="chatgptEnabled" className="text-sm text-foreground">Enable ChatGPT Integration</Label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createBotMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="button-create-bot"
            >
              {createBotMutation.isPending ? "Creating..." : "Create Bot Instance"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
