import { z } from "zod";
import { invokeCommand } from "./client";
import {
  imageFormatSchema,
  imageInputSchema,
  imageInspectionSchema,
  imageOutputSchema,
  imageProcessSchema,
} from "@/features/images/model";

export const imagesIpc = {
  inspect: (jobId: string, input: z.infer<typeof imageInputSchema>) =>
    invokeCommand("image_inspect", imageInspectionSchema, {
      jobId: z.uuid().parse(jobId),
      input: imageInputSchema.parse(input),
    }),
  process: (request: z.infer<typeof imageProcessSchema>) =>
    invokeCommand("image_process", imageOutputSchema, {
      request: imageProcessSchema.parse(request),
    }),
  cancel: (jobId: string) =>
    invokeCommand("image_cancel", z.null(), { jobId: z.uuid().parse(jobId) }),
  export: (
    jobId: string,
    input: z.infer<typeof imageInputSchema>,
    format: z.infer<typeof imageFormatSchema>,
    fileName: string,
  ) =>
    invokeCommand(
      "image_export",
      z.object({ saved: z.boolean(), fileName: z.string().nullable() }),
      {
        jobId: z.uuid().parse(jobId),
        input: imageInputSchema.parse(input),
        format: imageFormatSchema.parse(format),
        fileName: z.string().min(1).max(255).parse(fileName),
      },
    ),
};
