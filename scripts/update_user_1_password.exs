alias Messaging.Accounts

user_id = 1
new_password = "Soccer-Baller-12"
hashed_password = Bcrypt.hash_pwd_salt(new_password)

IO.puts("Generated bcrypt hash for manual update:")
IO.puts(hashed_password)
IO.puts("\nSQL:")
IO.puts("UPDATE users SET hashed_password = '#{hashed_password}', updated_at = NOW() WHERE id = #{user_id};")
IO.puts("\nAttempting context-based password update as well...")

try do
  user = Accounts.get_user!(user_id)

  case Accounts.update_user_password(user, %{password: new_password}) do
    {:ok, {_updated_user, _expired_tokens}} ->
      IO.puts("Updated password for user id #{user_id}")

    {:error, changeset} ->
      IO.puts("Failed to update password for user id #{user_id}")
      IO.inspect(changeset.errors, label: "validation_errors")
  end
rescue
  Ecto.NoResultsError ->
    IO.puts("User with id #{user_id} was not found")
end
