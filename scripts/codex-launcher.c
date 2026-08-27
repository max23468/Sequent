#define _GNU_SOURCE

#include <errno.h>
#include <grp.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

int main(int argc, char **argv) {
  (void)argc;
  char executable[PATH_MAX];
  const ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 6);
  if (length < 0) {
    fprintf(stderr, "codex launcher: readlink failed: %s\n", strerror(errno));
    return 126;
  }

  const char suffix[] = ".real";
  if ((size_t)length + sizeof(suffix) > sizeof(executable)) {
    fputs("codex launcher: executable path is too long\n", stderr);
    return 126;
  }
  memcpy(executable + length, suffix, sizeof(suffix));

  if (setgroups(0, NULL) != 0 || setregid(0, 0) != 0 || setreuid(0, 0) != 0) {
    fprintf(stderr, "codex launcher: privilege setup failed: %s\n", strerror(errno));
    return 126;
  }
  execv(executable, argv);
  fprintf(stderr, "codex launcher: exec failed: %s\n", strerror(errno));
  return 126;
}
