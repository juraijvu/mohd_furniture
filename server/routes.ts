import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { 
  projects, 
  projectImages, 
  segmentationMasks, 
  colorApplications, 
  recentColors, 
  insertProjectSchema, 
  insertProjectImageSchema,
  insertSegmentationMaskSchema,
  insertColorApplicationSchema
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join, extname } from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import Replicate from "replicate";

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

const UPLOAD_DIR = join(process.cwd(), "uploads");
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export async function registerRoutes(app: Express): Promise<Server> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }

  app.post("/api/upload", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const ext = extname(req.file.originalname).toLowerCase();
      const safeFileName = `${randomUUID()}${ext}`;
      const filePath = join(UPLOAD_DIR, safeFileName);
      
      await writeFile(filePath, req.file.buffer);

      const imagePath = `/uploads/${safeFileName}`;
      const domain = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
        : 'http://localhost:5000';
      const fullUrl = `${domain}${imagePath}`;

      res.json({ 
        path: imagePath,
        fullUrl,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  app.get("/api/projects", async (_req, res) => {
    try {
      const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt));
      res.json(allProjects);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const project = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      
      if (project.length === 0) {
        return res.status(404).json({ message: "Project not found" });
      }

      const images = await db.select().from(projectImages).where(eq(projectImages.projectId, id));
      const colors = await db.select().from(colorApplications).where(eq(colorApplications.projectId, id));

      res.json({
        project: project[0],
        images,
        colorApplications: colors
      });
    } catch (error) {
      console.error("Failed to fetch project:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const validated = insertProjectSchema.parse(req.body);
      
      const [newProject] = await db.insert(projects).values(validated).returning();

      res.json(newProject);
    } catch (error) {
      console.error("Failed to create project:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid project data", error });
      }
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validated = insertProjectSchema.parse(req.body);

      const [updatedProject] = await db.update(projects)
        .set({ 
          ...validated,
          updatedAt: new Date()
        })
        .where(eq(projects.id, id))
        .returning();

      if (!updatedProject) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json(updatedProject);
    } catch (error) {
      console.error("Failed to update project:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid project data", error });
      }
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.delete(projects).where(eq(projects.id, id));
      res.json({ message: "Project deleted successfully" });
    } catch (error) {
      console.error("Failed to delete project:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  app.post("/api/projects/:projectId/images", async (req, res) => {
    try {
      const { projectId } = req.params;
      const validated = insertProjectImageSchema.parse({
        ...req.body,
        projectId
      });

      const [newImage] = await db.insert(projectImages).values(validated).returning();
      res.json(newImage);
    } catch (error) {
      console.error("Failed to save image:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid image data", error });
      }
      res.status(500).json({ message: "Failed to save image" });
    }
  });

  app.post("/api/segment", async (req, res) => {
    try {
      const { imageUrl, clickX, clickY, imageId, autoSegment } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ message: "Missing required parameter: imageUrl" });
      }

      if (imageId) {
        const existingImage = await db.select().from(projectImages).where(eq(projectImages.id, imageId)).limit(1);
        if (existingImage.length === 0) {
          return res.status(400).json({ message: "Invalid imageId: image not found" });
        }
      }

      console.log(autoSegment ? `Auto-segmenting entire image using SAM` : `Segmenting image at (${clickX}, ${clickY}) using SAM`);

      const input: any = {
        image: imageUrl,
      };

      if (autoSegment) {
        const output = await replicate.run(
          "cjwbw/semantic-segment-anything",
          { input }
        );

        console.log('SAM auto-segmentation result:', output);

        const masks = Array.isArray(output) ? output : [];
        const processedMasks = masks.map((mask: any, index: number) => ({
          maskId: `mask-${index}`,
          maskData: mask.segmentation || '',
          boundingBox: {
            x: mask.bbox?.[0] || 0,
            y: mask.bbox?.[1] || 0,
            width: mask.bbox?.[2] || 0,
            height: mask.bbox?.[3] || 0
          },
          partLabel: mask.class_name || `Part ${index + 1}`,
          confidence: mask.stability_score || mask.predicted_iou || 1,
          area: mask.area || 0,
          clickX: null,
          clickY: null
        }));

        res.json({ masks: processedMasks });
      } else {
        if (clickX === undefined || clickY === undefined) {
          return res.status(400).json({ message: "Missing required parameters: clickX, clickY for point-based segmentation" });
        }

        input.point = [[clickX, clickY]];
        input.point_labels = [1];

        const output = await replicate.run(
          "lucataco/segment-anything-2",
          { input }
        );

        console.log('SAM point-based segmentation result:', output);

        res.json({
          maskUrl: output,
          clickX,
          clickY,
          boundingBox: { x: 0, y: 0, width: 0, height: 0 }
        });
      }
    } catch (error) {
      console.error("Segmentation error:", error);
      res.status(500).json({ 
        message: "Failed to segment image",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/colors", async (req, res) => {
    try {
      const validated = insertColorApplicationSchema.parse(req.body);
      const [newColor] = await db.insert(colorApplications).values(validated).returning();
      res.json(newColor);
    } catch (error) {
      console.error("Failed to save color:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid color data", error });
      }
      res.status(500).json({ message: "Failed to save color" });
    }
  });

  app.use('/uploads', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });

  const httpServer = createServer(app);

  return httpServer;
}
