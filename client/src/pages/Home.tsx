import { useState } from "react";
import Header from "@/components/Header";
import ColorPalette from "@/components/ColorPalette";
import UploadZone from "@/components/UploadZone";
import { CanvasWorkspace } from "@/components/CanvasWorkspace";
import PropertiesPanel from "@/components/PropertiesPanel";
import ProjectGallery from "@/components/ProjectGallery";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import type { ColorItem } from "@/data/colorPalette";
import sofaImage from '@assets/generated_images/Modern_grey_sofa_furniture_4bccca05.png';
import chairImage from '@assets/generated_images/Beige_dining_chair_c4cca64b.png';
import officeChairImage from '@assets/generated_images/Brown_office_chair_3fdc19ca.png';
import tableImage from '@assets/generated_images/Round_wooden_side_table_c2d711ab.png';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface FurniturePart {
  maskId: string;
  maskData: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  partLabel: string;
  confidence: number;
  area: number;
}

export default function Home() {
  const [projectName, setProjectName] = useState("Untitled Project");
  const [selectedColor, setSelectedColor] = useState<ColorItem | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedImageId, setUploadedImageId] = useState<string | null>(null);
  const [recentColors, setRecentColors] = useState<ColorItem[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [furnitureParts, setFurnitureParts] = useState<FurniturePart[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleColorSelect = (color: ColorItem) => {
    setSelectedColor(color);
    
    setRecentColors(prev => {
      const filtered = prev.filter(c => c.id !== color.id);
      return [color, ...filtered].slice(0, 8);
    });
  };

  const handleImageUpload = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      
      setUploadedImage(data.fullUrl);
      setProjectName(file.name.replace(/\.[^/.]+$/, ""));
      
      const projectToUse = currentProjectId ? currentProjectId : (await createProjectMutation.mutateAsync({
        name: file.name.replace(/\.[^/.]+$/, ""),
        previewImageUrl: data.path
      })).id;
      
      if (!currentProjectId) {
        setCurrentProjectId(projectToUse);
      }
      
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        try {
          const imageRecord = await fetch(`/api/projects/${projectToUse}/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: projectToUse,
              originalImagePath: data.path,
              mimeType: data.mimetype,
              width: img.naturalWidth,
              height: img.naturalHeight
            })
          });
          
          if (imageRecord.ok) {
            const imageData = await imageRecord.json();
            setUploadedImageId(imageData.id);
          }
        } catch (err) {
          console.error('Failed to save image record:', err);
        }
      };
      img.onerror = () => {
        console.error('Failed to load image:', data.fullUrl);
        toast({
          title: "Image Load Failed",
          description: "The uploaded image couldn't be loaded. Please try again.",
          variant: "destructive"
        });
      };
      img.src = data.fullUrl;
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload furniture image. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleAnalyzeFurniture = async () => {
    if (!uploadedImage) {
      toast({
        title: "No Image",
        description: "Please upload a furniture image first.",
        variant: "destructive"
      });
      return;
    }

    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: uploadedImage,
          imageId: uploadedImageId,
          autoSegment: true
        })
      });

      if (!response.ok) {
        throw new Error('Segmentation failed');
      }

      const data = await response.json();
      setFurnitureParts(data.masks || []);
      
      toast({
        title: "Analysis Complete",
        description: `Detected ${data.masks?.length || 0} furniture parts`,
      });
    } catch (error) {
      console.error('Segmentation error:', error);
      toast({
        title: "Analysis Failed",
        description: "Failed to analyze furniture parts. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const { data: projects } = useQuery({
    queryKey: ['/api/projects'],
    queryFn: async () => {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Failed to fetch projects');
      return response.json();
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: async (projectData: { name: string; previewImageUrl?: string }) => {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData)
      });
      if (!response.ok) throw new Error('Failed to create project');
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/projects'] })
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete project');
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/projects'] })
  });

  const loadProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) throw new Error('Failed to load project');
      const data = await response.json();
      
      if (data.project) {
        setProjectName(data.project.name);
        setCurrentProjectId(data.project.id);
        
        if (data.project.previewImageUrl) {
          setUploadedImage(data.project.previewImageUrl);
        }
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const handleDownload = () => {
    console.log('Download triggered');
  };

  const handleSave = async () => {
    if (!currentProjectId) {
      const project = await createProjectMutation.mutateAsync({
        name: projectName,
        previewImageUrl: uploadedImage || undefined
      });
      setCurrentProjectId(project.id);
    }
  };

  const galleryProjects = [
    { id: '1', name: 'Modern Grey Sofa', thumbnail: sofaImage, date: 'Nov 1, 2025' },
    { id: '2', name: 'Beige Dining Chair', thumbnail: chairImage, date: 'Oct 30, 2025' },
    { id: '3', name: 'Office Chair Design', thumbnail: officeChairImage, date: 'Oct 28, 2025' },
    { id: '4', name: 'Round Side Table', thumbnail: tableImage, date: 'Oct 27, 2025' },
    ...(projects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      thumbnail: p.previewImageUrl || sofaImage,
      date: new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }))
  ];

  return (
    <div className="h-screen flex flex-col bg-background">
      <Header 
        projectName={projectName}
        onProjectNameChange={setProjectName}
        onOpenGallery={() => setGalleryOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r bg-card flex-shrink-0">
          <ColorPalette 
            selectedColor={selectedColor}
            onColorSelect={handleColorSelect}
            recentColors={recentColors}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {uploadedImage ? (
            <div className="flex-1 relative">
              {furnitureParts.length === 0 && !isAnalyzing && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                  <div className="text-center space-y-4 max-w-md p-8">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <h2 className="text-2xl font-semibold">Furniture Image Uploaded</h2>
                    <p className="text-muted-foreground">
                      Click the button below to automatically detect all furniture parts (legs, seats, cushions, etc.) 
                      so you can precisely customize each part with your color palette.
                    </p>
                    <Button 
                      onClick={handleAnalyzeFurniture}
                      size="lg"
                      className="mt-4"
                      data-testid="button-analyze-furniture"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Analyze Furniture Parts
                    </Button>
                  </div>
                </div>
              )}
              {isAnalyzing && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                  <div className="text-center space-y-4">
                    <Loader2 className="w-16 h-16 animate-spin text-primary mx-auto" />
                    <h2 className="text-2xl font-semibold">Analyzing Furniture...</h2>
                    <p className="text-muted-foreground">
                      AI is detecting furniture parts. This may take 30-60 seconds.
                    </p>
                  </div>
                </div>
              )}
              <CanvasWorkspace 
                imageUrl={uploadedImage}
                selectedColor={selectedColor?.hexColor}
                imageId={uploadedImageId || undefined}
                furnitureParts={furnitureParts}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="w-full max-w-2xl">
                <UploadZone onImageUpload={handleImageUpload} />
                
                <div className="mt-8">
                  <h3 className="text-sm font-medium mb-4 text-center text-muted-foreground uppercase tracking-wide">
                    Try an Example
                  </h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { img: sofaImage, name: 'Modern Sofa' },
                      { img: chairImage, name: 'Dining Chair' },
                      { img: officeChairImage, name: 'Office Chair' },
                      { img: tableImage, name: 'Side Table' }
                    ].map((example, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setUploadedImage(example.img);
                          setProjectName(example.name);
                          setUploadedImageId(null);
                          setCurrentProjectId(null);
                        }}
                        className="group flex flex-col gap-2 p-3 rounded-lg border bg-card hover-elevate active-elevate-2"
                        data-testid={`button-example-${idx}`}
                      >
                        <div className="aspect-square rounded-md overflow-hidden bg-muted">
                          <img 
                            src={example.img} 
                            alt={example.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span className="text-xs text-center text-muted-foreground group-hover:text-foreground transition-colors">
                          {example.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-80 border-l bg-card flex-shrink-0">
          <PropertiesPanel 
            selectedColor={selectedColor}
            opacity={70}
            blendMode="multiply"
            onOpacityChange={() => {}}
            onBlendModeChange={() => {}}
            onDownload={handleDownload}
            onSave={handleSave}
          />
        </div>
      </div>

      <ProjectGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        projects={galleryProjects}
        onProjectSelect={(project) => {
          if (['1', '2', '3', '4'].includes(project.id)) {
            setUploadedImage(project.thumbnail);
            setProjectName(project.name);
            setCurrentProjectId(null);
          } else {
            loadProject(project.id);
          }
          setGalleryOpen(false);
        }}
        onProjectDelete={(id) => {
          if (!['1', '2', '3', '4'].includes(id)) {
            deleteProjectMutation.mutate(id);
          }
        }}
        onProjectDuplicate={(id) => console.log('Duplicate project:', id)}
      />
    </div>
  );
}
