import type { IBinaryData } from 'n8n-workflow';

import type { OperationContext } from './engine';

/**
 * Size in bytes of an n8n binary property, determined without loading the data:
 * from the binary data store metadata (filesystem/S3 mode) or from the length of the
 * base64 string n8n already holds in memory (default mode).
 */
export async function binarySize(ctx: OperationContext, binary: IBinaryData): Promise<number> {
	if (binary.id) {
		const meta = await ctx.ef.helpers.getBinaryMetadata(binary.id);
		return Number(meta.fileSize);
	}
	return Buffer.byteLength(binary.data ?? '', 'base64');
}

/**
 * A File whose content is read from n8n binary data while the request is sent, instead of
 * being copied into memory first. n8n's HTTP client (axios) serialises a FormData file part by
 * reading its `size` (for Content-Length) and iterating `stream()`, so the upload never needs a
 * second in-memory copy of the file.
 */
class StreamedFile extends File {
	constructor(
		name: string,
		length: number,
		private readonly source: () => AsyncIterable<Uint8Array>,
	) {
		super([], name, { type: 'application/octet-stream' });
		// `size` is an accessor on Blob; report the real length of the streamed content
		Object.defineProperty(this, 'size', { value: length, enumerable: true });
	}

	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		return this.source() as unknown as ReadableStream<Uint8Array<ArrayBuffer>>;
	}
}

/**
 * Returns a file part for FormData that streams the binary property: from the binary data store
 * when the binary has an ID, otherwise from the buffer n8n already holds (no extra copy).
 * Append it without a file name argument, which would make FormData copy it.
 */
export async function streamedBinaryFile(
	ctx: OperationContext,
	binary: IBinaryData,
	propertyName: string,
	fileName: string,
): Promise<{ file: File; size: number }> {
	const size = await binarySize(ctx, binary);
	const helpers = ctx.ef.helpers;
	const itemIndex = ctx.itemIndex;
	const source = binary.id
		? async function* () {
				yield* (await helpers.getBinaryStream(binary.id as string)) as AsyncIterable<Uint8Array>;
			}
		: async function* () {
				yield await helpers.getBinaryDataBuffer(itemIndex, propertyName);
			};
	return { file: new StreamedFile(fileName, size, source), size };
}
