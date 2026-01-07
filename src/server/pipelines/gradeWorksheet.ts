import { GenerationStatus, WorksheetQuestionType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";
import z from "zod";
import { inference } from "../../utils/inference.js";
import { getAIUserId } from "../../utils/aiUser.js";
import { pusher } from "../../lib/pusher.js";


const removeAllPreviousAIComments = async (worksheetQuestionProgressId: string) => {
    await prisma.comment.deleteMany({
        where: {
            studentQuestionProgressId: worksheetQuestionProgressId,
            authorId: getAIUserId(),
        },
    });
};

const gradeWorksheetQuestion = async (worksheetResponseId: string, worksheetQuestionProgressId: string) => {

    const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId },
        include: {
            worksheet: true,
        },
    });

    if (!worksheetResponse) {
        logger.error('Worksheet response not found');
        throw new Error('Worksheet response not found');
    }    

    const studentQuestionProgress = await prisma.studentQuestionProgress.findFirst({
        where: {
            id: worksheetQuestionProgressId,
        },
        include: {
            question: true,
            comments: true,
        },
    });

    if (!studentQuestionProgress) {
        logger.error('Student question progress not found');
        throw new Error('Student question progress not found');
    }

    pusher.trigger(`class-${worksheetResponse.worksheet.classId}-worksheetSubmission-${worksheetResponse.id}`, `set-pending`, {
        id: studentQuestionProgress.id,
    });

    const question = studentQuestionProgress.question;
    const comments = studentQuestionProgress.comments;
    const responseText = studentQuestionProgress.response;


    try {
        const apiResponse = await inference(
            `Grade the following worksheet response:
            
            Question: ${question.question}
            Response: ${responseText}

            Comments: ${comments.map((comment) => comment.content).join('\n')}
            Mark Scheme: ${JSON.stringify(question.markScheme)}
            
            Justify your reasoning by including comment(s) and mark the question please.         
            Return ONLY JSON in the following format (fill in the values as per the question):
           {
            "isCorrect": <boolean>,
            "points": <number>,
            "markschemeState": [
                { "id": <string>, "correct": <boolean> }
            ],
            "comments": [<string>, ...]
            }
            `,
            z.object({
                isCorrect: z.boolean(),
                points: z.number(),
                markschemeState: z.array(z.object({
                    id: z.string(),
                    correct: z.boolean(),
                  })), // @note: this has to be converted to [id: string]: correct boolean
                comments: z.array(z.string()),
            }),
        ).catch((error) => {
            logger.error('Failed to grade worksheet response', { error });
            throw error;
        });

        const updatedStudentQuestionProgress = await prisma.studentQuestionProgress.update({
            where: { id: studentQuestionProgress.id, status: {
                not: {
                    in: ['CANCELLED'],
                },
            } },
            data: {
                status: GenerationStatus.COMPLETED,
                isCorrect: (apiResponse as { isCorrect: boolean }).isCorrect,
                points: (apiResponse as { points: number }).points,
                markschemeState: (apiResponse as {
                    markschemeState: { id: string; correct: boolean }[];
                }).markschemeState.reduce((acc, curr) => {
                    acc["item-" + curr.id] = curr.correct;
                    return acc;
                }, {} as Record<string, boolean>),
                comments: {
                    create: (apiResponse as {
                        comments: string[];
                    }).comments.map((commentContent) => ({
                        content: commentContent,
                        authorId: getAIUserId(),
                    })),
                },
            },
        });
        pusher.trigger(`class-${worksheetResponse.worksheet.classId}-worksheetSubmission-${worksheetResponse.id}`, `set-completed`, {
            id: updatedStudentQuestionProgress.id,
        });

        return updatedStudentQuestionProgress;
    } catch (error) {
        logger.error('Failed to grade worksheet response', { error, worksheetResponseId });
        pusher.trigger(`class-${worksheetResponse.worksheet.classId}-worksheetSubmission-${worksheetResponse.id}`, `set-failed`, {
            id: studentQuestionProgress.id,
        });
        await prisma.studentQuestionProgress.update({
            where: { id: studentQuestionProgress.id },
            data: { status: GenerationStatus.FAILED },
        });
        throw error;
    }
}

/**
 * Grades and regrades worksheet (can fixed failed responses)
 * @param worksheetResponseId worksheet response id
 * @returns updated worksheet response
 */

const DO_NOT_INFERENCE_STATUSES = [GenerationStatus.CANCELLED, GenerationStatus.PENDING, GenerationStatus.COMPLETED];

export const gradeWorksheetPipeline = async (worksheetResponseId: string) => {
    logger.info('Grading worksheet response', { worksheetResponseId });
    const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId },
        include: {
            worksheet: true,
            responses: {
                where: {
                    status: {
                        not: {
                            in: DO_NOT_INFERENCE_STATUSES,
                        },
                    },
                    question: {
                        type: {
                            not: {
                                in: [WorksheetQuestionType.MULTIPLE_CHOICE, WorksheetQuestionType.TRUE_FALSE],
                            }
                        },
                    },
                },
                include: {
                    question: true,
                    comments: true,
                },
            },
        },
    });

    if (!worksheetResponse) {
        logger.error('Worksheet response not found');
        throw new Error('Worksheet response not found');
    }

    // Use for...of instead of forEach to properly handle async operations
    for (const response of worksheetResponse.responses) {
        logger.info('Grading question', { questionId: response.questionId });

        const studentQuestionProgress = await prisma.studentQuestionProgress.update({
            where: { id: response.id, status: {
                not: {
                    in: DO_NOT_INFERENCE_STATUSES,
                }
            } },
            data: { status: GenerationStatus.PENDING },
        });

        if (studentQuestionProgress.status !== GenerationStatus.PENDING) {
            return;
        }

        gradeWorksheetQuestion(worksheetResponseId, response.id);

    };
};

export const cancelGradePipeline = async (worksheetResponseId: string, worksheetQuestionProgressId: string) => {
    logger.info('Cancelling auto grading', { worksheetResponseId, worksheetQuestionProgressId });

    const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId },
        include: {
            worksheet: true,
        },
    });
    if (!worksheetResponse) {
        logger.error('Worksheet response not found');
        throw new Error('Worksheet response not found');
    }
    const updatedStudentQuestionProgress = await prisma.studentQuestionProgress.update({
        where: { id: worksheetQuestionProgressId },
        data: { status: GenerationStatus.CANCELLED },
    });

    await removeAllPreviousAIComments(worksheetQuestionProgressId);

    pusher.trigger(`class-${worksheetResponse.worksheet.classId}-worksheetSubmission-${worksheetResponse.id}`, `set-cancelled`, {
        id: updatedStudentQuestionProgress.id,
    });

    return updatedStudentQuestionProgress;
};

export const regradeWorksheetPipeline = async (worksheetResponseId: string, worksheetQuestionProgressId: string) => {
    logger.info('Regrading worksheet response', { worksheetResponseId, worksheetQuestionProgressId });
    try {
    const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
        where: { id: worksheetResponseId, },
        include: {
            worksheet: true,
        },
    });
    
    await removeAllPreviousAIComments(worksheetQuestionProgressId);

    if (!worksheetResponse) {
        logger.error('Worksheet response not found');
        throw new Error('Worksheet response not found');
    }

    const updatedStudentQuestionProgress = await prisma.studentQuestionProgress.update({
        where: { id: worksheetQuestionProgressId },
        data: { status: GenerationStatus.PENDING },
    });

console.log(updatedStudentQuestionProgress);

    gradeWorksheetQuestion(worksheetResponseId, worksheetQuestionProgressId);

    return updatedStudentQuestionProgress;
    } catch (error) {
        await prisma.studentQuestionProgress.update({
            where: { id: worksheetQuestionProgressId },
            data: { status: GenerationStatus.FAILED },
        });
        const worksheetResponse = await prisma.studentWorksheetResponse.findUnique({
            where: { id: worksheetResponseId, },
            include: {
                worksheet: true,
            },
        });
        if (!worksheetResponse) {
            logger.error('Worksheet response not found');
            throw new Error('Worksheet response not found');
        }
        pusher.trigger(`class-${worksheetResponse.worksheet.classId}-worksheetSubmission-${worksheetResponse.id}`, `set-failed`, {
            id: worksheetQuestionProgressId,
        });
        logger.error('Failed to regrade worksheet response', { error, worksheetResponseId, worksheetQuestionProgressId });
        throw error;
    }
};
