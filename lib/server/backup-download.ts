import { limitConcurrentRequests } from "./rate-limit.ts";

export async function createBackupDownload(
  store,
  user,
  series,
  headers: HeadersInit,
) {
  return await new Promise<Response>((resolve, reject) => {
    // Hold the shared large-transfer slot until the body is drained/cancelled,
    // not just until JSON.stringify finishes. Otherwise slow download clients
    // can retain arbitrarily many fully buffered backups after handlers return.
    void limitConcurrentRequests(
      0,
      () =>
        limitConcurrentRequests(user.id, async () => {
          let text = JSON.stringify(
            await store.forUser(user, () => store.exportLibrary(series)),
            null,
            2,
          );
          await new Promise<void>((done) => {
            let timer: ReturnType<typeof setTimeout>,
              offset = 0;
            const finish = () => {
              clearTimeout(timer);
              text = "";
              done();
            };
            const encoder = new TextEncoder();
            const body = new ReadableStream<Uint8Array>(
              {
                start(controller) {
                  timer = setTimeout(() => {
                    controller.error(new Error("Backup download timed out."));
                    finish();
                  }, 120_000);
                  timer.unref();
                },
                pull(controller) {
                  let end = Math.min(offset + 32 * 1024, text.length);
                  // Do not split a UTF-16 surrogate pair between encoded chunks.
                  if (
                    end < text.length &&
                    /[\uD800-\uDBFF]/.test(text[end - 1])
                  )
                    end++;
                  if (end > offset)
                    controller.enqueue(encoder.encode(text.slice(offset, end)));
                  offset = end;
                  if (offset === text.length) {
                    controller.close();
                    finish();
                  }
                },
                cancel: finish,
              },
              { highWaterMark: 0 },
            );
            resolve(new Response(body, { headers }));
          });
        }),
      1,
    ).catch(reject);
  });
}
