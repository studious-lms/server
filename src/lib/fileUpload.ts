import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";
import { getSignedUrl } from "./googleCloudStorage.js";
import { generateMediaThumbnail } from "./thumbnailGenerator.js";
import { prisma } from "./prisma.js";

export interface FileData {
  name: string;
  type: string;
  size: number;
  // No data field - for direct file uploads
}

export interface DirectFileData {
  name: string;
  type: string;
  size: number;
  // No data field - for direct file uploads
}

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  thumbnailId?: string;
}

export interface DirectUploadFile {
  id: string;
  name: string;
  type: string;
  size: number;
  path: string;
  uploadUrl: string;
  uploadExpiresAt: Date;
  uploadSessionId: string;
}

// DEPRECATED: These functions are no longer used - files are uploaded directly to GCS
// Use createDirectUploadFile() and createDirectUploadFiles() instead

/**
 * @deprecated Use createDirectUploadFile instead
 */
export async function uploadFile(
  file: FileData,
  userId: string,
  directory?: string,
  assignmentId?: string
): Promise<UploadedFile> {
  throw new TRPCError({
    code: 'NOT_IMPLEMENTED',
    message: 'uploadFile is deprecated. Use createDirectUploadFile instead.',
  });
}

/**
 * @deprecated Use createDirectUploadFiles instead
 */
export async function uploadFiles(
  files: FileData[], 
  userId: string,
  directory?: string
): Promise<UploadedFile[]> {
  throw new TRPCError({
    code: 'NOT_IMPLEMENTED',
    message: 'uploadFiles is deprecated. Use createDirectUploadFiles instead.',
  });
}

/**
 * Gets a signed URL for a file
 * @param filePath The path of the file in Google Cloud Storage
 * @returns The signed URL
 */
export async function getFileUrl(filePath: string): Promise<string> {
  try {
    return await getSignedUrl(filePath);
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to get file URL',
    });
  }
}

/**
 * Creates a file record for direct upload and generates signed URL
 * @param file The file metadata (no base64 data)
 * @param userId The ID of the user uploading the file
 * @param directory Optional directory to store the file in
 * @param assignmentId Optional assignment ID to associate the file with
 * @param submissionId Optional submission ID to associate the file with
 * @returns The direct upload file information with signed URL
 */
export async function createDirectUploadFile(
  file: DirectFileData,
  userId: string,
  directory?: string,
  assignmentId?: string,
  submissionId?: string
): Promise<DirectUploadFile> {
  try {
    // Validate file extension matches MIME type
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    const mimeType = file.type.toLowerCase();
    
    const extensionMimeMap: Record<string, string[]> = {
      'jpg': ['image/jpeg'],
      'jpeg': ['image/jpeg'],
      'png': ['image/png'],
      'gif': ['image/gif'],
      'webp': ['image/webp']
    };
    
    if (fileExtension && extensionMimeMap[fileExtension]) {
      if (!extensionMimeMap[fileExtension].includes(mimeType)) {
        throw new Error(`File extension .${fileExtension} does not match MIME type ${mimeType}`);
      }
    }
    
    // Create a unique filename
    const uniqueFilename = `${uuidv4()}.${fileExtension}`;
    
    // Construct the full path
    const filePath = directory 
      ? `${directory}/${uniqueFilename}`
      : uniqueFilename;
    
    // Generate upload session ID
    const uploadSessionId = uuidv4();
    
    // Generate backend proxy upload URL (not direct GCS)
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const uploadUrl = `${baseUrl}/api/upload/${encodeURIComponent(filePath)}`;
    const uploadExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
    
    // Create file record in database with PENDING status
    const fileRecord = await prisma.file.create({
      data: {
        name: file.name,
        type: file.type,
        size: file.size,
        path: filePath,
        uploadStatus: 'PENDING',
        uploadUrl,
        uploadExpiresAt,
        uploadSessionId,
        user: {
          connect: { id: userId }
        },
        ...(directory && {
          folder: {
            connect: {id: directory},
          },
        }),
        ...(assignmentId && {
          assignment: {
            connect: { id: assignmentId }
          }
        }),
        ...(submissionId && {
          submission: {
            connect: { id: submissionId }
          }
        })
      },
    });
    
    return {
      id: fileRecord.id,
      name: file.name,
      type: file.type,
      size: file.size,
      path: filePath,
      uploadUrl,
      uploadExpiresAt,
      uploadSessionId
    };
  } catch (error) {
    console.error('Error creating direct upload file:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create direct upload file',
    });
  }
}

/**
 * Confirms a direct upload was successful
 * @param fileId The ID of the file record
 * @param uploadSuccess Whether the upload was successful
 * @param errorMessage Optional error message if upload failed
 */
export async function confirmDirectUpload(
  fileId: string,
  uploadSuccess: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    const updateData: any = {
      uploadStatus: uploadSuccess ? 'COMPLETED' : 'FAILED',
      uploadProgress: uploadSuccess ? 100 : 0,
    };
    
    if (!uploadSuccess && errorMessage) {
      updateData.uploadError = errorMessage;
      updateData.uploadRetryCount = { increment: 1 };
    }
    
    if (uploadSuccess) {
      updateData.uploadedAt = new Date();
    }
    
    await prisma.file.update({
      where: { id: fileId },
      data: updateData
    });
  } catch (error) {
    console.error('Error confirming direct upload:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to confirm upload',
    });
  }
}

/**
 * Updates upload progress for a direct upload
 * @param fileId The ID of the file record
 * @param progress Progress percentage (0-100)
 */
export async function updateUploadProgress(
  fileId: string,
  progress: number
): Promise<void> {
  try {
    await prisma.file.update({
      where: { id: fileId },
      data: {
        uploadStatus: 'UPLOADING',
        uploadProgress: Math.min(100, Math.max(0, progress))
      }
    });
  } catch (error) {
    console.error('Error updating upload progress:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to update upload progress',
    });
  }
}

/**
 * Creates multiple direct upload files
 * @param files Array of file metadata
 * @param userId The ID of the user uploading the files
 * @param directory Optional subdirectory to store the files in
 * @param assignmentId Optional assignment ID to associate files with
 * @param submissionId Optional submission ID to associate files with
 * @returns Array of direct upload file information
 */
export async function createDirectUploadFiles(
  files: DirectFileData[], 
  userId: string,
  directory?: string,
  assignmentId?: string,
  submissionId?: string
): Promise<DirectUploadFile[]> {
  try {
    const uploadPromises = files.map(file => 
      createDirectUploadFile(file, userId, directory, assignmentId, submissionId)
    );
    return await Promise.all(uploadPromises);
  } catch (error) {
    console.error('Error creating direct upload files:', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create direct upload files',
    });
  }
}