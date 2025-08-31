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

const formSchema = insertBotInstanceSchema.extend({
  credentialsFile: z.any().optional(),
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

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      autoLike: false,
      autoViewStatus: false,
      autoReact: false,
      typingMode: "none",
      chatgptEnabled: false,
    },
  });

  const createBotMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const formData = new FormData();
      
      // Append form fields
      Object.entries(data).forEach(([key, value]) => {
        if (key !== 'credentialsFile') {
          formData.append(key, String(value));
        }
      });
      
      // Append file if selected
      if (selectedFile) {
        formData.append('credentials', selectedFile);
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
      if (file.name.endsWith('.json')) {
        setSelectedFile(file);
      } else {
        toast({ 
          title: "Invalid file type", 
          description: "Please select a valid JSON file",
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
              Upload Credentials
            </Label>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="block text-sm font-medium text-foreground mb-2">
                Auto Features
              </Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoLike"
                    checked={form.watch("autoLike") || false}
                    onCheckedChange={(checked) => form.setValue("autoLike", checked as boolean)}
                    data-testid="checkbox-auto-like"
                  />
                  <Label htmlFor="autoLike" className="text-sm text-foreground">Auto Like</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoViewStatus"
                    checked={form.watch("autoViewStatus") || false}
                    onCheckedChange={(checked) => form.setValue("autoViewStatus", checked as boolean)}
                    data-testid="checkbox-auto-view-status"
                  />
                  <Label htmlFor="autoViewStatus" className="text-sm text-foreground">Auto View Status</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoReact"
                    checked={form.watch("autoReact") || false}
                    onCheckedChange={(checked) => form.setValue("autoReact", checked as boolean)}
                    data-testid="checkbox-auto-react"
                  />
                  <Label htmlFor="autoReact" className="text-sm text-foreground">Auto React</Label>
                </div>
              </div>
            </div>

            <div>
              <Label className="block text-sm font-medium text-foreground mb-2">
                Typing Mode
              </Label>
              <Select value={form.watch("typingMode") || "none"} onValueChange={(value) => form.setValue("typingMode", value)}>
                <SelectTrigger className="w-full bg-input border-border text-foreground" data-testid="select-typing-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="typing">Always Typing</SelectItem>
                  <SelectItem value="recording">Recording Audio</SelectItem>
                  <SelectItem value="both">Both (Switch)</SelectItem>
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
