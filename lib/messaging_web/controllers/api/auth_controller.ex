defmodule MessagingWeb.API.AuthController do
  use MessagingWeb, :controller

  alias Messaging.Accounts
  alias Messaging.Accounts.User

  def register(conn, %{"email" => email, "password" => password}) do
    changeset =
      %User{}
      |> User.email_changeset(%{email: email})
      |> User.password_changeset(%{password: password})

    case Messaging.Repo.insert(changeset) do
      {:ok, user} ->
        token = Accounts.generate_user_session_token(user)
        encoded = Base.url_encode64(token, padding: false)

        conn
        |> put_status(:created)
        |> json(%{token: encoded, user: %{id: user.id, email: user.email}})

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  def login(conn, %{"email" => email, "password" => password}) do
    case Accounts.get_user_by_email_and_password(email, password) do
      %User{} = user ->
        token = Accounts.generate_user_session_token(user)
        encoded = Base.url_encode64(token, padding: false)

        json(conn, %{token: encoded, user: %{id: user.id, email: user.email}})

      nil ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid email or password"})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
