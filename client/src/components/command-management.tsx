import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Command {
  id: string;
  name: string;
  description: string;
  category: string;
  response?: string;
  isActive: boolean;
  customCode?: boolean;
}

interface CommandManagementProps {
  open: boolean;
  onClose: () => void;
}

const COMMAND_CATEGORIES = [
  'SYSTEM', 'ADMIN', 'CUSTOM', 'FUN', 'TOOLS', 'SEARCH', 'DOWNLOAD', 'CONVERT'
];

const EXAMPLE_COMMAND = `// Example WhatsApp bot command
// Available context: { respond, args, message, client }

const query = args.join(' ');
if (!query) {
  await respond('❌ Please provide a search query!');
  return;
}

await respond(\`🔍 Searching for: *\${query}*\`);
// Your custom logic here
await respond(\`✅ Results for: *\${query}*\`);`;

export default function CommandManagement({ open, onClose }: CommandManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'CUSTOM',
    code: EXAMPLE_COMMAND
  });

  // Fetch existing commands
  const { data: commands = [], isLoading } = useQuery({
    queryKey: ['/api/commands'],
    queryFn: async () => {
      const response = await fetch('/api/commands');
      if (!response.ok) throw new Error('Failed to fetch commands');
      return response.json();
    }
  });

  // Create custom command mutation
  const createCommandMutation = useMutation({
    mutationFn: async (commandData: typeof formData) => {
      const response = await fetch('/api/commands/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commandData),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create command');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Custom command created successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/commands'] });
      setFormData({
        name: '',
        description: '',
        category: 'CUSTOM',
        code: EXAMPLE_COMMAND
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create command",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.description || !formData.code) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    createCommandMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">🔧 TREKKER-MD Command Management</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Command Creation Form */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Create Custom Command</CardTitle>
                <CardDescription>
                  Add custom JavaScript code that will execute when users call your command
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="name">Command Name *</Label>
                    <Input
                      id="name"
                      placeholder="mycommand"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="font-mono"
                    />
                  </div>

                  <div>
                    <Label htmlFor="description">Description *</Label>
                    <Input
                      id="description"
                      placeholder="What does this command do?"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label htmlFor="category">Category</Label>
                    <Select 
                      value={formData.category} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMAND_CATEGORIES.map(category => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="code">Command Code *</Label>
                    <Textarea
                      id="code"
                      placeholder="Your JavaScript code here..."
                      value={formData.code}
                      onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                      className="min-h-[300px] font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Available context: respond, args, message, client
                    </p>
                  </div>

                  <Button 
                    type="submit" 
                    disabled={createCommandMutation.isPending}
                    className="w-full"
                  >
                    {createCommandMutation.isPending ? "Creating..." : "Create Command"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Existing Commands List */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Existing Commands ({commands.length})</CardTitle>
                <CardDescription>
                  All commands available in your TREKKER-MD bot
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-2 text-sm text-muted-foreground">Loading commands...</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {commands.map((command: Command) => (
                      <div 
                        key={command.id} 
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                      >
                        <div>
                          <div className="font-mono text-sm font-semibold">
                            .{command.name}
                            {command.customCode && (
                              <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
                                CUSTOM
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{command.description}</p>
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded mt-1 inline-block">
                            {command.category}
                          </span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${command.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Command Example */}
            <Card>
              <CardHeader>
                <CardTitle>💡 Command Example</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                  {EXAMPLE_COMMAND}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}