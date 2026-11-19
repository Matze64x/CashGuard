cmake_minimum_required(VERSION 3.19)
project(CashGuard)
set(CMAKE_CXX_STANDARD 23)

set(SDL3_DIR "${PROJECT_SOURCE_DIR}/dependencies/SDL3")
set(SPDLOG_DIR "${PROJECT_SOURCE_DIR}/dependencies/spdlog")

add_subdirectory("${SDL3_DIR}")
add_subdirectory("${SPDLOG_DIR}")

find_package(OpenGL REQUIRED)

# Data model and file format, without UI; shared by the app and the tests.
add_library(cashguard_core OBJECT
	src/account_model.cpp
	src/category_model.cpp
	src/cg_file_handler.cpp
	src/transaction.cpp
	src/transaction_model.cpp
	src/util/color.cpp
	src/util/random_generator.cpp
)
target_include_directories(cashguard_core PUBLIC
	"${PROJECT_SOURCE_DIR}/include"
	"${PROJECT_SOURCE_DIR}/dependencies/"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/"
	"${SPDLOG_DIR}/include")
target_link_libraries(cashguard_core PUBLIC spdlog::spdlog)

set(SOURCE_FILES
	src/application.cpp
	src/dialogs.cpp
	src/graphs.cpp
	src/inputs.cpp
	src/transaction_filter.cpp
	src/transaction_table.cpp
	src/ui.cpp
	src/window.cpp
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/imgui.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/backends/imgui_impl_sdl3.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/backends/imgui_impl_opengl3.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/imgui_draw.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/imgui_widgets.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/imgui_tables.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/implot/implot.cpp"
	"${PROJECT_SOURCE_DIR}/dependencies/implot/implot_items.cpp"
)

add_executable(CashGuard src/main.cpp ${SOURCE_FILES})

target_include_directories(CashGuard PRIVATE
	"${PROJECT_SOURCE_DIR}/include"
	"${PROJECT_SOURCE_DIR}/dependencies/"
	"${PROJECT_SOURCE_DIR}/dependencies/imgui/"
	"${PROJECT_SOURCE_DIR}/dependencies/implot/"
	"${PROJECT_SOURCE_DIR}/dependencies/portable-file-dialogs/"
	"${SDL3_DIR}/include/"
	"${SPDLOG_DIR}/include")

target_link_libraries(CashGuard
	cashguard_core
	OpenGL::GL
	SDL3::SDL3
	spdlog::spdlog
)
if (CMAKE_IMPORT_LIBRARY_SUFFIX)
	add_custom_command(TARGET CashGuard POST_BUILD
		COMMAND ${CMAKE_COMMAND} -E copy_if_different
		$<TARGET_RUNTIME_DLLS:CashGuard>
		$<TARGET_FILE_DIR:CashGuard>
		COMMAND_EXPAND_LISTS
	)
endif()

# Format conformance test shared with the web client (web/tests/fixtures). Run with: ctest --test-dir bDebug
option(CASHGUARD_BUILD_TESTS "Build the tests" ON)
if (CASHGUARD_BUILD_TESTS)
	enable_testing()
	add_executable(cashguard_roundtrip_test tests/roundtrip_test.cpp)
	target_link_libraries(cashguard_roundtrip_test cashguard_core)
	add_test(NAME format_roundtrip COMMAND cashguard_roundtrip_test "${PROJECT_SOURCE_DIR}/web/tests/fixtures")
endif()
