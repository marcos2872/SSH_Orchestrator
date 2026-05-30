#include <winpr/wtypes.h>
#include <winpr/file.h>
#include <winpr/path.h>
#include <freerdp/server/proxy/proxy_config.h>

static bool runconf(proxyConfig* config)
{
	bool rc = false;
	if (!config)
		goto fail;

	// TODO: Add more checks
	rc = true;
fail:
	pf_server_config_free(config);
	return rc;
}

static bool runtest(const char* filename)
{
	proxyConfig* fconfig = pf_server_config_load_file(filename);
	return runconf(fconfig);
}

int TestFreeRDPProxyConfig(WINPR_ATTR_UNUSED int argc, WINPR_ATTR_UNUSED char* argv[])
{
	int rc = -1;
	HANDLE hFind = INVALID_HANDLE_VALUE;
	char* tests = GetCombinedPath(CMAKE_CURRENT_SOURCE_DIR, "conf");
	if (!tests)
		return -1;

	char* search = GetCombinedPath(tests, "*");
	if (!search)
		goto fail;

	WIN32_FIND_DATAA FindData = WINPR_C_ARRAY_INIT;

	hFind = FindFirstFileA(search, &FindData);
	free(search);

	if (hFind == INVALID_HANDLE_VALUE)
	{
		printf("FindFirstFile failure: %s (INVALID_HANDLE_VALUE -1)\n", tests);
		goto fail;
	}

	do
	{
		printf("FindFirstFile: %s\n", FindData.cFileName);
		if ((strcmp(".", FindData.cFileName) == 0) || (strcmp("..", FindData.cFileName) == 0))
			continue;

		char* file = GetCombinedPath(tests, FindData.cFileName);
		if (!file)
			goto fail;
		const bool res = runtest(file);
		free(file);
		if (!res)
			goto fail;
	} while (FindNextFileA(hFind, &FindData));

	rc = 0;
fail:
	if (hFind != INVALID_HANDLE_VALUE)
		FindClose(hFind);

	free(tests);
	return rc;
}
