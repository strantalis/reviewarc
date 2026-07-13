#ifndef REVIEWARC_SPARKLE_BRIDGE_H
#define REVIEWARC_SPARKLE_BRIDGE_H

#include <stdint.h>

// All returned strings are heap allocated and must be released with
// ra_sparkle_free_string.
int ra_sparkle_initialize(const char *feed_url, int allows_beta, char **error_out);
int ra_sparkle_set_allows_beta(int allows_beta, char **error_out);
int ra_sparkle_check(int interactive, char **error_out);
int ra_sparkle_install_and_restart(char **error_out);
char *ra_sparkle_status_json(void);
void ra_sparkle_free_string(char *value);

#endif
