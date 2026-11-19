// Format conformance test: every given file (or every *.json in a given directory) must survive
// load + save through CGFileHandler byte-identically. The same fixtures are checked by the web
// client's tests, which keeps both clients' readers and writers in agreement.
//
// Usage: cashguard_roundtrip_test <file-or-directory>...
// Copies are written to ./roundtrip_test_output/ in the working directory.

#include "cg_file_handler.hpp"
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <vector>

namespace fs = std::filesystem;

static std::string read_file(const fs::path& path)
{
	std::ifstream file(path, std::ios::binary);
	std::stringstream stream;
	stream << file.rdbuf();
	return stream.str();
}

static bool check_file(const fs::path& path, const fs::path& output_dir)
{
	const fs::path copy = output_dir / path.filename();
	fs::copy_file(path, copy, fs::copy_options::overwrite_existing);
	try
	{
		CGFileHandler handler;
		TransactionModel transaction_model;
		AccountModel account_model;
		CategoryModel category_model;
		if (!handler.load_from_file(copy, transaction_model, account_model, category_model))
		{
			std::cerr << "FAIL (load) " << path.string() << "\n";
			return false;
		}
		if (!handler.save_to_file(copy, transaction_model, account_model, category_model))
		{
			std::cerr << "FAIL (save) " << path.string() << "\n";
			return false;
		}
	}
	catch (const std::exception& e)
	{
		std::cerr << "FAIL (exception: " << e.what() << ") " << path.string() << "\n";
		return false;
	}
	if (read_file(path) != read_file(copy))
	{
		std::cerr << "FAIL (differs after load + save, see " << copy.string() << ") " << path.string() << "\n";
		return false;
	}
	return true;
}

int main(int argc, char** argv)
{
	if (argc < 2)
	{
		std::cerr << "usage: " << argv[0] << " <file-or-directory>...\n";
		return 2;
	}
	std::vector<fs::path> files;
	for (int i = 1; i < argc; i++)
	{
		const fs::path path(argv[i]);
		if (fs::is_directory(path))
		{
			for (const fs::directory_entry& entry : fs::directory_iterator(path))
			{
				if (entry.path().extension() == ".json") files.push_back(entry.path());
			}
		}
		else files.push_back(path);
	}
	if (files.empty())
	{
		std::cerr << "no .json files found\n";
		return 2;
	}
	const fs::path output_dir = fs::current_path() / "roundtrip_test_output";
	fs::create_directories(output_dir);
	int failures = 0;
	for (const fs::path& file : files)
	{
		if (!check_file(file, output_dir)) failures++;
	}
	std::cout << (files.size() - failures) << "/" << files.size() << " files round-tripped byte-identically\n";
	return failures == 0 ? 0 : 1;
}
