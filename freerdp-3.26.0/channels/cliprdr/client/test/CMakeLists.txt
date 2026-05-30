set(FUZZER_NAME TestFuzzChannelCliprdr)

add_fuzzer_test(${FUZZER_NAME} "winpr freerdp freerdp-client")
